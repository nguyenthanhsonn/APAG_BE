import { Injectable } from '@nestjs/common';
import { FormStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { mapToAdminListItem } from '../training-evaluations/helpers/evaluation.mapper';
import { resolveSemesterId } from '../training-evaluations/helpers/semester.helper';
import { evaluationAdminListSelect } from '../training-evaluations/selects/evaluation-form.select';
import { ReportsAggregateQueryDto } from './dto/reports-aggregate-query.dto';
import { ReportsExportQueryDto } from './dto/reports-export-query.dto';
import {
  buildRankDistribution,
  buildStatusDistribution,
  calculateAverage,
  emptyRankDistribution,
  flattenForExport,
  pivotRankByClass,
  rollUpToFaculties,
} from './helpers/report-aggregation.helper';
import type {
  FlatExportRow,
  ReportByClassItem,
  ReportByFacultyItem,
  ReportOverviewResponse,
  TrainingResultsResponse,
} from './types/report.types';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bức tranh tổng quan theo trạng thái duyệt (bao gồm mọi trạng thái: draft → finalized/rejected).
   * Dùng để admin theo dõi tiến độ nộp/duyệt phiếu trong học kỳ.
   */
  async getOverview(query: ReportsAggregateQueryDto): Promise<ReportOverviewResponse> {
    const where = await this.buildWhere(query, { finalizedOnly: false });

    const [totalForms, statusGroups] = await Promise.all([
      this.prisma.evaluationForm.count({ where }),
      this.prisma.evaluationForm.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    return {
      totalForms,
      byStatus: buildStatusDistribution(statusGroups),
    };
  }

  /**
   * Kết quả rèn luyện đã chốt chính thức toàn hệ thống — chỉ tính phiếu `finalized`
   * (đã qua đủ 3 cấp duyệt) vì đây mới là kết quả có giá trị chính thức.
   */
  async getTrainingResults(
    query: ReportsAggregateQueryDto,
  ): Promise<TrainingResultsResponse> {
    const where = await this.buildWhere(query, { finalizedOnly: true });

    const [rankGroups, scoreAggregate] = await Promise.all([
      this.prisma.evaluationForm.groupBy({
        by: ['rank'],
        where,
        _count: { _all: true },
      }),
      this.prisma.evaluationForm.aggregate({
        where,
        _sum: { finalScore: true },
        _count: { _all: true },
      }),
    ]);

    return {
      totalFinalized: scoreAggregate._count._all,
      averageFinalScore: calculateAverage(
        scoreAggregate._sum.finalScore,
        scoreAggregate._count._all,
      ),
      byRank: buildRankDistribution(rankGroups),
    };
  }

  /** Kết quả rèn luyện đã chốt, gom nhóm theo từng lớp. */
  async getByClass(query: ReportsAggregateQueryDto): Promise<ReportByClassItem[]> {
    const { rankGroups, sumGroups } = await this.getFinalizedGroups(query);

    const classIds = sumGroups.map((group) => group.classId);
    const classes = await this.prisma.class.findMany({
      where: { id: { in: classIds } },
      select: { id: true, code: true, name: true },
    });
    const classMap = new Map(classes.map((cls) => [cls.id, cls]));
    const rankByClass = pivotRankByClass(rankGroups);

    return sumGroups.map((sumGroup) => {
      const cls = classMap.get(sumGroup.classId);

      return {
        classId: sumGroup.classId,
        classCode: cls?.code ?? '',
        className: cls?.name ?? '',
        totalFinalized: sumGroup._count._all,
        averageFinalScore: calculateAverage(
          sumGroup._sum.finalScore,
          sumGroup._count._all,
        ),
        byRank: rankByClass.get(sumGroup.classId) ?? emptyRankDistribution(),
      };
    });
  }

  /** Kết quả rèn luyện đã chốt, gom nhóm theo khoa (roll-up từ dữ liệu theo lớp). */
  async getByFaculty(query: ReportsAggregateQueryDto): Promise<ReportByFacultyItem[]> {
    const { rankGroups, sumGroups } = await this.getFinalizedGroups(query);

    const classIds = sumGroups.map((group) => group.classId);
    const classes = await this.prisma.class.findMany({
      where: { id: { in: classIds } },
      select: {
        id: true,
        major: { select: { faculty: { select: { id: true, code: true, name: true } } } },
      },
    });
    const classToFaculty = new Map(
      classes.map((cls) => [cls.id, cls.major.faculty]),
    );

    return rollUpToFaculties(sumGroups, rankGroups, classToFaculty);
  }

  /**
   * Toàn bộ danh sách phiếu khớp bộ lọc (không phân trang) để render ra file Excel/PDF.
   * Sắp xếp theo lớp rồi tên sinh viên — phù hợp cho tài liệu đọc/lưu trữ hơn là "mới nhất trước".
   */
  async getExportRows(query: ReportsExportQueryDto, limit?: number): Promise<FlatExportRow[]> {
    const semesterId = await resolveSemesterId(
      this.prisma,
      query.semester,
      query.academicYear,
    );

    const where: Prisma.EvaluationFormWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.classId && { classId: query.classId }),
      ...(query.facultyId && { class: { major: { facultyId: query.facultyId } } }),
      ...(semesterId && { semesterId }),
    };

    const evaluations = await this.prisma.evaluationForm.findMany({
      where,
      ...(limit ? { take: limit } : {}),
      select: evaluationAdminListSelect,
      orderBy: [{ class: { name: 'asc' } }, { student: { fullName: 'asc' } }],
    });

    return evaluations.map(mapToAdminListItem).map(flattenForExport);
  }

  // ─── Private: truy vấn dùng chung ──────────────────────────────────────────

  /** Truy vấn song song 2 nhóm dữ liệu thô (xếp loại theo lớp + tổng điểm theo lớp) cho phiếu finalized. */
  private async getFinalizedGroups(query: ReportsAggregateQueryDto) {
    const where = await this.buildWhere(query, { finalizedOnly: true });

    const [rankGroups, sumGroups] = await Promise.all([
      this.prisma.evaluationForm.groupBy({
        by: ['classId', 'rank'],
        where,
        _count: { _all: true },
      }),
      this.prisma.evaluationForm.groupBy({
        by: ['classId'],
        where,
        _sum: { finalScore: true },
        _count: { _all: true },
      }),
    ]);

    return { rankGroups, sumGroups };
  }

  /** Dựng where clause dùng chung cho các API gom nhóm số liệu. */
  private async buildWhere(
    query: ReportsAggregateQueryDto,
    options: { finalizedOnly: boolean },
  ): Promise<Prisma.EvaluationFormWhereInput> {
    const semesterId = await resolveSemesterId(
      this.prisma,
      query.semester,
      query.academicYear,
    );

    return {
      ...(options.finalizedOnly && { status: FormStatus.finalized }),
      ...(semesterId && { semesterId }),
      ...(query.classId && { classId: query.classId }),
      ...(query.facultyId && { class: { major: { facultyId: query.facultyId } } }),
    };
  }
}
