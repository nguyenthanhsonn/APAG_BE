import { lockSemesterActivation } from './semester-activation';
import { throwBusinessUniqueConflict } from '../../common/helpers/business-uniqueness.helper';
import { notificationDedupeKey } from '../notifications/create-notification-once';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SemesterNo,
  UserRole as PrismaUserRole,
} from '../../generated/prisma/client';
import { parseOptionalDateOnly } from '../../common/helpers/date-only.helper';
import { PrismaService } from '../../database/prisma.service';
import type { PaginatedResult } from '../../common/shared';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { toSemesterLabel } from '../notifications/notifications.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { GetSemestersQueryDto } from './dto/get-semesters-query.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';
import {
  mapToSemesterResponse,
  toApiSemester,
  toSemesterNo,
  toSemesterName,
} from './semesters.service';
import { clearSemesterCache } from '../training-evaluations/helpers/semester.helper';
import type { SemesterResponse } from './types/semester.types';

type SemesterNotificationRecord = {
  id: string;
  year: number;
  semester: SemesterNo;
  studentDeadline: Date | null;
};

@Injectable()
export class AdminSemestersService {
  private readonly logger = new Logger(AdminSemestersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async findAll(
    query: GetSemestersQueryDto,
  ): Promise<PaginatedResult<SemesterResponse>> {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const where: Prisma.SemesterWhereInput = {
      ...(query.year !== undefined && { year: query.year }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
    };

    const [items, total] = await Promise.all([
      this.prisma.semester.findMany({
        where,
        select: semesterSelect,
        orderBy: [{ year: 'desc' }, { semester: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.semester.count({ where }),
    ]);

    return {
      items: items.map(mapToSemesterResponse),
      page,
      limit,
      total,
    };
  }

  async findOne(id: string): Promise<SemesterResponse> {
    const semester = await this.findRecordById(id);
    return mapToSemesterResponse(semester);
  }

  async create(dto: CreateSemesterDto): Promise<SemesterResponse> {
    const semester = toSemesterNo(dto.semester);
    const data = this.buildSemesterData(dto);
    this.validateDateOrder(data);
    const startDate = data.startDate;
    const endDate = data.endDate;

    if (!startDate || !endDate) {
      throw new BadRequestException(
        'Ngày bắt đầu và ngày kết thúc là bắt buộc',
      );
    }

    await this.validateNoOverlap(startDate, endDate);
    await this.assertUniqueSemester(dto.year, semester);

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          await lockSemesterActivation(tx);
          if (dto.isActive) {
            await this.deactivateActiveSemestersAndLockForms(tx);
          }

          return tx.semester.create({
            data: {
              year: dto.year,
              semester,
              startDate,
              endDate,
              studentDeadline: data.studentDeadline,
              classDeadline: data.classDeadline,
              facultyDeadline: data.facultyDeadline,
              isActive: dto.isActive ?? false,
            },
            select: semesterSelect,
          });
        },
        { isolationLevel: 'ReadCommitted' },
      );

      clearSemesterCache();
      return mapToSemesterResponse(created);
    } catch (error) {
      this.handleKnownSemesterError(error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateSemesterDto): Promise<SemesterResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Chưa cung cấp thông tin cần cập nhật');
    }

    const current = await this.findRecordById(id);
    const hasForms = await this.hasEvaluationForms(id);
    const nextYear = dto.year ?? current.year;
    const nextSemester = dto.semester
      ? toSemesterNo(dto.semester)
      : current.semester;

    if (
      hasForms &&
      (dto.year !== undefined ||
        dto.semester !== undefined ||
        dto.startDate !== undefined ||
        dto.endDate !== undefined)
    ) {
      throw new BadRequestException(
        'Học kỳ đã phát sinh phiếu đánh giá, không thể sửa năm học, học kỳ, ngày bắt đầu hoặc ngày kết thúc',
      );
    }

    if (nextYear !== current.year || nextSemester !== current.semester) {
      await this.assertUniqueSemester(nextYear, nextSemester, id);
    }

    const nextData = this.buildSemesterData(dto, current);
    this.validateDateOrder(nextData);
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      await this.validateNoOverlap(nextData.startDate, nextData.endDate, id);
    }

    let wasActive = current.isActive;
    try {
      let closedSemesters: SemesterNotificationRecord[] = [];
      const updated = await this.prisma.$transaction(
        async (tx) => {
          await lockSemesterActivation(tx);
          // Đọc lại sau khi có khóa: request khác có thể vừa chuyển active trong lúc ta chờ.
          wasActive = (await this.findRecordById(id, tx)).isActive;
          if (dto.isActive === true && !wasActive) {
            closedSemesters = await this.deactivateActiveSemestersAndLockForms(
              tx,
              id,
            );
            await this.unlockEvaluationFormsBySemesterIds(tx, [id]);
          }

          if (dto.isActive === false && wasActive) {
            await this.lockEvaluationFormsBySemesterIds(tx, [id]);
          }

          return tx.semester.update({
            where: { id },
            data: {
              ...(dto.year !== undefined && { year: nextYear }),
              ...(dto.semester !== undefined && { semester: nextSemester }),
              ...(dto.startDate !== undefined && {
                startDate: nextData.startDate,
              }),
              ...(dto.endDate !== undefined && { endDate: nextData.endDate }),
              ...(dto.studentDeadline !== undefined && {
                studentDeadline: nextData.studentDeadline,
              }),
              ...(dto.classDeadline !== undefined && {
                classDeadline: nextData.classDeadline,
              }),
              ...(dto.facultyDeadline !== undefined && {
                facultyDeadline: nextData.facultyDeadline,
              }),
              ...(dto.isActive !== undefined && { isActive: dto.isActive }),
            },
            select: semesterSelect,
          });
        },
        { isolationLevel: 'ReadCommitted' },
      );

      clearSemesterCache();
      this.notifyStudentsAfterActiveChange(updated, {
        opened: false,
        closedSemesters:
          dto.isActive === false && wasActive ? [current] : closedSemesters,
      });

      if (dto.isActive === true && !wasActive) {
        this.notifyStudentsSemesterOpened(updated).catch((err: unknown) =>
          this.logger.error(
            'Gửi thông báo mở kỳ đánh giá thất bại',
            err instanceof Error ? err.stack : String(err),
          ),
        );
      }

      return mapToSemesterResponse(updated);
    } catch (error) {
      this.handleKnownSemesterError(error);
      throw error;
    }
  }

  async toggleActive(id: string, isActive: boolean): Promise<SemesterResponse> {
    let closedSemesters: SemesterNotificationRecord[] = [];

    try {
      const { target, updated } = await this.prisma.$transaction(
        async (tx) => {
          await lockSemesterActivation(tx);
          const target = await this.findRecordById(id, tx);
          if (isActive) {
            closedSemesters = await this.deactivateActiveSemestersAndLockForms(
              tx,
              id,
            );
            await this.unlockEvaluationFormsBySemesterIds(tx, [id]);
          } else {
            await this.lockEvaluationFormsBySemesterIds(tx, [id]);
          }

          const updated = await tx.semester.update({
            where: { id },
            data: { isActive },
            select: semesterSelect,
          });
          return { target, updated };
        },
        { isolationLevel: 'ReadCommitted' },
      );

      clearSemesterCache();
      this.notifyStudentsAfterActiveChange(updated, {
        opened: false,
        closedSemesters:
          !isActive && target.isActive ? [target] : closedSemesters,
      });

      if (isActive && !target.isActive) {
        this.notifyStudentsSemesterOpened(updated).catch((err: unknown) =>
          this.logger.error(
            'Gửi thông báo mở kỳ đánh giá thất bại',
            err instanceof Error ? err.stack : String(err),
          ),
        );
      }

      return mapToSemesterResponse(updated);
    } catch (error) {
      this.handleKnownSemesterError(error);
      throw error;
    }
  }

  private async findRecordById(
    id: string,
    database: Prisma.TransactionClient = this.prisma,
  ) {
    const semester = await database.semester.findUnique({
      where: { id },
      select: semesterSelect,
    });

    if (!semester) {
      throw new NotFoundException('Không tìm thấy học kỳ');
    }

    return semester;
  }

  private async assertUniqueSemester(
    year: number,
    semester: SemesterNo,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.semester.findUnique({
      where: { year_semester: { year, semester } },
      select: { id: true },
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException('Học kỳ này đã tồn tại trong hệ thống');
    }
  }

  private async validateNoOverlap(
    startDate: Date | undefined,
    endDate: Date | undefined,
    excludeId?: string,
  ): Promise<void> {
    if (!startDate || !endDate) {
      return;
    }

    const overlapping = await this.prisma.semester.findFirst({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: {
        id: true,
        year: true,
        semester: true,
        startDate: true,
        endDate: true,
      },
    });

    if (!overlapping) {
      return;
    }

    throw new BadRequestException(
      `Khoảng ngày bị trùng với học kỳ ${overlapping.year} - ${toApiSemester(overlapping.semester)} (${formatVietnamDate(overlapping.startDate)} - ${formatVietnamDate(overlapping.endDate)})`,
    );
  }

  private async hasEvaluationForms(semesterId: string): Promise<boolean> {
    const count = await this.prisma.evaluationForm.count({
      where: { semesterId },
    });

    return count > 0;
  }

  private buildSemesterData(
    dto: Partial<CreateSemesterDto>,
    fallback?: {
      startDate: Date;
      endDate: Date;
      studentDeadline: Date | null;
      classDeadline: Date | null;
      facultyDeadline: Date | null;
    },
  ) {
    return {
      startDate:
        parseOptionalDateOnly(dto.startDate, 'Ngày bắt đầu') ??
        fallback?.startDate,
      endDate:
        parseOptionalDateOnly(dto.endDate, 'Ngày kết thúc') ??
        fallback?.endDate,
      studentDeadline:
        dto.studentDeadline !== undefined
          ? parseOptionalDateOnly(dto.studentDeadline, 'Hạn sinh viên')
          : (fallback?.studentDeadline ?? null),
      classDeadline:
        dto.classDeadline !== undefined
          ? parseOptionalDateOnly(dto.classDeadline, 'Hạn cấp lớp')
          : (fallback?.classDeadline ?? null),
      facultyDeadline:
        dto.facultyDeadline !== undefined
          ? parseOptionalDateOnly(dto.facultyDeadline, 'Hạn cấp khoa')
          : (fallback?.facultyDeadline ?? null),
    };
  }

  private validateDateOrder(data: {
    startDate?: Date;
    endDate?: Date;
    studentDeadline?: Date | null;
    classDeadline?: Date | null;
    facultyDeadline?: Date | null;
  }): void {
    if (!data.startDate || !data.endDate) {
      throw new BadRequestException(
        'Ngày bắt đầu và ngày kết thúc là bắt buộc',
      );
    }

    const orderedDates = [
      { label: 'Ngày bắt đầu', value: data.startDate },
      ...(data.studentDeadline
        ? [{ label: 'Hạn sinh viên', value: data.studentDeadline }]
        : []),
      ...(data.classDeadline
        ? [{ label: 'Hạn cấp lớp', value: data.classDeadline }]
        : []),
      ...(data.facultyDeadline
        ? [{ label: 'Hạn cấp khoa', value: data.facultyDeadline }]
        : []),
      { label: 'Ngày kết thúc', value: data.endDate },
    ];

    for (let index = 1; index < orderedDates.length; index += 1) {
      const previous = orderedDates[index - 1];
      const current = orderedDates[index];

      if (!previous || !current) {
        continue;
      }

      if (previous.value.getTime() > current.value.getTime()) {
        throw new BadRequestException(
          `${previous.label} phải trước hoặc bằng ${current.label}`,
        );
      }
    }
  }

  private async deactivateActiveSemestersAndLockForms(
    tx: Prisma.TransactionClient,
    excludeSemesterId?: string,
  ): Promise<SemesterNotificationRecord[]> {
    const activeSemesters = await tx.semester.findMany({
      where: {
        isActive: true,
        ...(excludeSemesterId && { id: { not: excludeSemesterId } }),
      },
      select: semesterNotificationSelect,
    });
    const activeSemesterIds = activeSemesters.map((semester) => semester.id);

    if (activeSemesterIds.length === 0) {
      return [];
    }

    await Promise.all([
      tx.semester.updateMany({
        where: { id: { in: activeSemesterIds } },
        data: { isActive: false },
      }),
      this.lockEvaluationFormsBySemesterIds(tx, activeSemesterIds),
    ]);

    return activeSemesters;
  }

  private async lockEvaluationFormsBySemesterIds(
    tx: Prisma.TransactionClient,
    semesterIds: string[],
  ): Promise<void> {
    if (semesterIds.length === 0) {
      return;
    }

    await tx.evaluationForm.updateMany({
      where: {
        semesterId: { in: semesterIds },
        isLocked: false,
      },
      data: {
        version: { increment: 1 },
        isLocked: true,
        lockedAt: new Date(),
        lockedBy: null,
      },
    });
  }

  private async unlockEvaluationFormsBySemesterIds(
    tx: Prisma.TransactionClient,
    semesterIds: string[],
  ): Promise<void> {
    if (semesterIds.length === 0) {
      return;
    }

    await tx.evaluationForm.updateMany({
      where: {
        semesterId: { in: semesterIds },
        isLocked: true,
      },
      data: {
        version: { increment: 1 },
        isLocked: false,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  private notifyStudentsAfterActiveChange(
    openedSemester: SemesterNotificationRecord,
    options: {
      opened: boolean;
      closedSemesters: SemesterNotificationRecord[];
    },
  ): void {
    if (options.closedSemesters.length === 0) {
      return;
    }

    void this.createSemesterChangeNotifications(openedSemester, options).catch(
      (error: unknown) => {
        this.logger.error(
          'Gửi thông báo chuyển học kỳ thất bại',
          error instanceof Error ? error.stack : String(error),
        );
      },
    );
  }

  private async createSemesterChangeNotifications(
    openedSemester: SemesterNotificationRecord,
    options: {
      opened: boolean;
      closedSemesters: SemesterNotificationRecord[];
    },
  ): Promise<void> {
    const students = await this.prisma.user.findMany({
      where: {
        role: PrismaUserRole.student,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (students.length === 0) {
      return;
    }

    const notifications: Prisma.NotificationCreateManyInput[] = [];

    for (const closedSemester of options.closedSemesters) {
      const title = `${toSemesterName(closedSemester.semester)} ${closedSemester.year}-${closedSemester.year + 1} đã kết thúc`;
      const content =
        'Phiếu đánh giá rèn luyện của học kỳ này đã được khóa. Bạn vẫn có thể xem lại nhưng không thể chỉnh sửa.';

      notifications.push(
        ...students.map((student) => ({
          userId: student.id,
          type: NotificationType.EVALUATION_PERIOD_CLOSED,
          dedupeKey: notificationDedupeKey(student.id, [
            'semester-closed',
            closedSemester.id,
          ]),
          title,
          content,
        })),
      );
    }

    if (notifications.length === 0) {
      return;
    }

    const created = await this.prisma.notification.createManyAndReturn({
      data: notifications,
      skipDuplicates: true,
      select: { userId: true },
    });
    this.emitNotificationRefreshInBatches([
      ...new Set(created.map((row) => row.userId)),
    ]);
  }

  private async notifyStudentsSemesterOpened(
    semester: SemesterNotificationRecord,
  ): Promise<void> {
    const students = await this.prisma.user.findMany({
      where: {
        role: PrismaUserRole.student,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (students.length === 0) {
      return;
    }

    const label = toSemesterLabel(semester.semester);
    const year = `${semester.year}-${semester.year + 1}`;
    const deadlineText = semester.studentDeadline
      ? `Hạn nộp: ${formatVietnamDate(semester.studentDeadline)}.`
      : '';
    const deadlinePart = deadlineText ? ` ${deadlineText}` : '';

    const title = 'Mở đánh giá rèn luyện';
    const content = `${label} năm học ${year} hiện đã được mở để thực hiện đánh giá rèn luyện.${deadlinePart} Đây là bước quan trọng trong quá trình xét kết quả rèn luyện, ảnh hưởng trực tiếp đến quyền lợi học bổng, thi đua, khen thưởng và các chế độ khác của bạn tại trường. Vui lòng vào hệ thống để thực hiện tự đánh giá càng sớm càng tốt.`;

    const notifications = students.map((student) => ({
      userId: student.id,
      type: NotificationType.NEW_EVALUATION_PERIOD,
      dedupeKey: notificationDedupeKey(student.id, [
        'semester-opened',
        semester.id,
      ]),
      title,
      content,
    }));

    const created = await this.prisma.notification.createManyAndReturn({
      data: notifications,
      skipDuplicates: true,
      select: { userId: true },
    });
    this.emitNotificationRefreshInBatches(created.map((row) => row.userId));
  }

  private emitNotificationRefreshInBatches(
    userIds: string[],
    batchSize = 500,
  ): void {
    let index = 0;

    const emitBatch = () => {
      const batch = userIds.slice(index, index + batchSize);
      batch.forEach((userId) => {
        this.notificationsGateway.emitRefresh(userId);
      });

      index += batchSize;
      if (index < userIds.length) {
        setImmediate(emitBatch);
      }
    };

    emitBatch();
  }

  private handleKnownSemesterError(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return;
    }

    throwBusinessUniqueConflict(error);

    if (error.code === 'P2025') {
      throw new NotFoundException('Không tìm thấy học kỳ');
    }
  }
}

const semesterSelect = {
  id: true,
  year: true,
  semester: true,
  startDate: true,
  endDate: true,
  studentDeadline: true,
  classDeadline: true,
  facultyDeadline: true,
  isActive: true,
} as const;

const semesterNotificationSelect = {
  id: true,
  year: true,
  semester: true,
  studentDeadline: true,
} as const;

function formatVietnamDate(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}
