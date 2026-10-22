import { EvidencesService } from '../src/modules/evidences/evidences.service';
import { EvidencesController } from '../src/modules/evidences/evidences.controller';
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { UserRole } from '../src/common/shared';
import { idempotentOperation } from '../src/common/idempotency/idempotent-operation';
import { createNotificationOnce } from '../src/modules/notifications/create-notification-once';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { reviewerFixture } from './fixtures/evaluation.fixture';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import {
  PrismaClient,
  FormStatus,
  EvalRank,
  SemesterNo,
} from '../src/generated/prisma/client';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { EvaluationFinalizeService } from '../src/modules/training-evaluations/application/evaluation-finalize.service';
import { EvaluationQueryService } from '../src/modules/training-evaluations/application/evaluation-query.service';
import { EvaluationReviewService } from '../src/modules/training-evaluations/application/evaluation-review.service';
import { EvaluationScoreService } from '../src/modules/training-evaluations/application/evaluation-score.service';
import { EvaluationSubmitService } from '../src/modules/training-evaluations/application/evaluation-submit.service';
import { AdminTrainingEvaluationsController } from '../src/modules/training-evaluations/presentation/admin-training-evaluations.controller';
import { TrainingEvaluationsController } from '../src/modules/training-evaluations/presentation/training-evaluations.controller';

// Test chỉ ghi trong schema sinh ngẫu nhiên; không sửa record nghiệp vụ hiện có.
// Chạy bằng pnpm test:concurrency để cấp TEST_DATABASE_URL từ cấu hình local.
const postgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

postgres('optimistic evaluation concurrency on PostgreSQL', () => {
  const schema = `evaluation_occ_${randomBytes(8).toString('hex')}`;
  const studentId = randomUUID();
  const semesterId = randomUUID();
  let pool: Pool;
  let prisma: PrismaClient;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 6,
      connectionTimeoutMillis: 5000,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      `CREATE TABLE "${schema}".evaluation_forms (LIKE public.evaluation_forms INCLUDING DEFAULTS)`,
    );
    await pool.query(
      `ALTER TABLE "${schema}".evaluation_forms ADD PRIMARY KEY (id)`,
    );
    // Prisma cast enum theo schema của adapter; clone type để không dùng type của public.
    for (const [name, column, values] of [
      ['FormStatus', 'status', Object.values(FormStatus)],
      ['EvalRank', 'rank', Object.values(EvalRank)],
    ] as const) {
      await pool.query(
        `CREATE TYPE "${schema}"."${name}" AS ENUM (${values.map((value) => `'${value}'`).join(',')})`,
      );
      await pool.query(
        `ALTER TABLE "${schema}".evaluation_forms ALTER COLUMN "${column}" DROP DEFAULT`,
      );
      await pool.query(
        `ALTER TABLE "${schema}".evaluation_forms ALTER COLUMN "${column}" TYPE "${schema}"."${name}" USING "${column}"::text::"${schema}"."${name}"`,
      );
    }
    await pool.query(
      `ALTER TABLE "${schema}".evaluation_forms ALTER COLUMN status SET DEFAULT 'draft'::"${schema}"."FormStatus"`,
    );
    for (const table of [
      'users',
      'class_leader_assignments',
      'advisor_assignments',
      'faculty_assignments',
      'classes',
      'majors',
      'faculties',
      'evidences',
      'operation_receipts',
      'notifications',
      'form_criteria_scores',
      'evaluation_criteria',
      'semesters',
    ]) {
      await pool.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    await pool.query(
      `CREATE TYPE "${schema}"."SemesterNo" AS ENUM ('1', '2', 'summer')`,
    );
    await pool.query(
      `ALTER TABLE "${schema}".semesters ALTER COLUMN semester TYPE "${schema}"."SemesterNo" USING semester::text::"${schema}"."SemesterNo"`,
    );
    await pool.query(
      `CREATE TYPE "${schema}"."UserRole" AS ENUM ('student','class_leader','advisor','faculty','admin','training_department')`,
    );
    await pool.query(
      `ALTER TABLE "${schema}".users ALTER COLUMN role DROP DEFAULT`,
    );
    await pool.query(
      `ALTER TABLE "${schema}".users ALTER COLUMN role TYPE "${schema}"."UserRole" USING role::text::"${schema}"."UserRole"`,
    );
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    await prisma.semester.create({
      data: {
        id: semesterId,
        year: 2026,
        semester: SemesterNo.SEMESTER_1,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        isActive: true,
      },
    });
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (prisma) {
      await prisma.classLeaderAssignment.deleteMany();
      await prisma.advisorAssignment.deleteMany();
      await prisma.facultyAssignment.deleteMany();
      await prisma.class.deleteMany();
      await prisma.major.deleteMany();
      await prisma.faculty.deleteMany();
      await prisma.user.deleteMany();
      await prisma.evidence.deleteMany();
      await prisma.evaluationForm.deleteMany();
      await prisma.operationReceipt.deleteMany();
      await prisma.notification.deleteMany();
      await prisma.formCriteriaScore.deleteMany();
      await prisma.semester.updateMany({
        data: {
          studentDeadline: null,
          classDeadline: null,
          facultyDeadline: null,
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (pool) {
      // Chỉ xóa schema do chính test này tạo, không DROP database hoặc schema public.
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  async function createForm(status: FormStatus = FormStatus.draft) {
    return prisma.evaluationForm.create({
      data: {
        id: randomUUID(),
        studentId,
        classId: randomUUID(),
        semesterId,
        status,
        classScore: 80,
      },
      select: { id: true, version: true },
    });
  }

  it('returns one 200 and one 409 for two HTTP requests that read the same version', async () => {
    const form = await createForm();
    expect(form.version).toBe(0);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Test lỗi validation/HTTP không được để request còn lại chờ barrier vô hạn.
    const barrierTimeout = setTimeout(release, 3000);
    barrierTimeout.unref();
    const concurrentClient = prisma.$extends({
      query: {
        evaluationForm: {
          async findFirst({ args, query }) {
            const snapshot = await query(args);
            // Barrier sau SELECT, trước CAS: hai request chắc chắn đều đọc version 0.
            reads += 1;
            if (reads === 2) release();
            if (reads <= 2) await bothRead;
            return snapshot;
          },
        },
      },
    });
    const scores = new EvaluationScoreService(
      concurrentClient as never,
      {} as never,
      { invalidate: jest.fn() } as never,
    );
    const module = await Test.createTestingModule({
      controllers: [TrainingEvaluationsController],
      providers: [
        { provide: EvaluationScoreService, useValue: scores },
        { provide: EvaluationQueryService, useValue: {} },
        { provide: EvaluationSubmitService, useValue: {} },
        { provide: EvaluationReviewService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            id: studentId,
            role: UserRole.Student,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();

    const roleBody = {
      studentRoleType: 'NORMAL_STUDENT',
      normalStudentActivityScore: 3,
      specialAchievementLevel: 'SCHOOL_LEVEL_OR_HIGHER',
    };
    const studyBody = {
      regularScoreLevel: 'GTE_9',
      academicRank: 'EXCELLENT',
      activities: [{ code: 'ACADEMIC_EVENT_PARTICIPATION', checked: true }],
    };
    const base = `/api/v1/training-evaluations/${form.id}`;
    const responses = await Promise.all([
      request(app.getHttpServer()).patch(`${base}/role-score`).send(roleBody),
      request(app.getHttpServer()).patch(`${base}/study-score`).send(studyBody),
    ]);
    clearTimeout(barrierTimeout);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const stored = await prisma.evaluationForm.findUniqueOrThrow({
      where: { id: form.id },
    });
    expect(stored.version).toBe(1);
    expect(stored.studentScore).toBe(
      stored.studyScore +
        stored.disciplineScore +
        stored.activityScore +
        stored.communityScore +
        stored.roleScore,
    );
    const winner = responses.findIndex((response) => response.status === 200);
    expect(responses[winner]!.body.data.version).toBe(1);
    expect(stored.studentScore).toBe(winner === 0 ? 10 : 16);

    // Retry là request mới đọc version mới; không tự retry ngầm snapshot cũ.
    const retry =
      winner === 0
        ? await request(app.getHttpServer())
            .patch(`${base}/study-score`)
            .send(studyBody)
        : await request(app.getHttpServer())
            .patch(`${base}/role-score`)
            .send(roleBody);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ version: 2, totalScore: 26 });
  });

  it('rolls back the whole finalize batch when a later candidate has a stale version', async () => {
    const forms = await Promise.all([
      createForm(FormStatus.faculty_approved),
      createForm(FormStatus.faculty_approved),
    ]);
    const sorted = [...forms].sort((a, b) => a.id.localeCompare(b.id));
    const last = sorted[1]!;
    let invalidated = false;
    const concurrentClient = prisma.$extends({
      query: {
        evaluationForm: {
          async findMany({ args, query }) {
            const snapshots = await query(args);
            if (!invalidated) {
              invalidated = true;
              await prisma.evaluationForm.updateMany({
                where: { id: last.id },
                data: { version: { increment: 1 } },
              });
            }
            return snapshots;
          },
        },
      },
    });
    const service = new EvaluationFinalizeService(concurrentClient as never);
    await expect(
      service.bulkFinalize(
        { id: randomUUID(), role: UserRole.Admin },
        { ids: forms.map((form) => form.id) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const stored = await prisma.evaluationForm.findMany({
      orderBy: { id: 'asc' },
    });
    expect(stored).toHaveLength(2);
    expect(
      stored.every((form) => form.status === FormStatus.faculty_approved),
    ).toBe(true);
    expect(stored.find((form) => form.id === sorted[0]!.id)!.version).toBe(0);
    expect(stored.find((form) => form.id === last.id)!.version).toBe(1);
  });

  it('allows only one concurrent state finalization of the same form', async () => {
    const form = await createForm(FormStatus.faculty_approved);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrierTimeout = setTimeout(release, 3000);
    barrierTimeout.unref();
    const concurrentClient = prisma.$extends({
      query: {
        evaluationForm: {
          async findMany({ args, query }) {
            const snapshots = await query(args);
            reads += 1;
            if (reads === 2) release();
            if (reads <= 2) await bothRead;
            return snapshots;
          },
        },
      },
    });
    const service = new EvaluationFinalizeService(concurrentClient as never);
    const results = await Promise.allSettled([
      service.bulkFinalize(
        { id: randomUUID(), role: UserRole.Admin },
        { ids: [form.id] },
      ),
      service.bulkFinalize(
        { id: randomUUID(), role: UserRole.Admin },
        { ids: [form.id] },
      ),
    ]);
    clearTimeout(barrierTimeout);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected');
    expect(loser?.status).toBe('rejected');
    if (loser?.status === 'rejected') {
      expect(loser.reason).toBeInstanceOf(ConflictException);
      expect(loser.reason.getStatus()).toBe(409);
    }
    const stored = await prisma.evaluationForm.findUniqueOrThrow({
      where: { id: form.id },
    });
    expect(stored).toMatchObject({
      status: FormStatus.finalized,
      finalScore: 80,
      version: 1,
    });
  });

  function lifecycleServices() {
    const notifications = { emitCreated: jest.fn() };
    const queries = {
      assertClassAccess: jest.fn().mockResolvedValue(undefined),
      assertFormAccess: jest.fn().mockResolvedValue(undefined),
    };
    const finalize = new EvaluationFinalizeService(prisma as never);
    const scores = new EvaluationScoreService(
      prisma as never,
      queries as never,
      { invalidate: jest.fn() } as never,
    );
    return {
      notifications,
      scores,
      submit: new EvaluationSubmitService(
        prisma as never,
        notifications as never,
        queries as never,
      ),
      review: new EvaluationReviewService(
        prisma as never,
        notifications as never,
        queries as never,
        scores,
        finalize,
      ),
      finalize,
    };
  }

  it('replays concurrent submit requests, including dates, without resetting scores twice', async () => {
    const form = await createForm();
    const { submit } = lifecycleServices();
    const results = await Promise.all([
      submit.submit(
        { id: studentId, role: UserRole.Student },
        form.id,
        'submit-1',
      ),
      submit.submit(
        { id: studentId, role: UserRole.Student },
        form.id,
        'submit-1',
      ),
    ]);
    expect(results[1]).toEqual(results[0]);
    const replay = await lifecycleServices().submit.submit(
      { id: studentId, role: UserRole.Student },
      form.id,
      'submit-1',
    );
    expect(replay).toEqual(results[0]);
    expect(replay.review.submittedAt).toBeInstanceOf(Date);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ status: FormStatus.submitted, version: 1 });
    expect(await prisma.operationReceipt.count()).toBe(1);
  });

  it('replays confirmation and approval; reject creates one notification and a new cycle can submit again', async () => {
    const form = await createForm(FormStatus.class_leader_approved);
    const { review, submit, notifications } = lifecycleServices();
    const advisor = { ...reviewerFixture(UserRole.Advisor), id: randomUUID() };
    const confirms = await Promise.all([
      review.confirmReview(advisor, form.id, {}, 'confirm-1'),
      review.confirmReview(advisor, form.id, {}, 'confirm-1'),
    ]);
    expect(confirms[0]).toEqual(confirms[1]);
    expect(confirms[0].version).toBe(1);
    const rejected = await Promise.all([
      review.returnToStudent(
        advisor,
        form.id,
        { reason: 'Bổ sung minh chứng' },
        'reject-1',
      ),
      review.returnToStudent(
        advisor,
        form.id,
        { reason: 'Bổ sung minh chứng' },
        'reject-1',
      ),
    ]);
    expect(rejected[0]).toEqual(rejected[1]);
    expect(await prisma.notification.count()).toBe(1);
    expect(notifications.emitCreated).toHaveBeenCalledTimes(1);
    const submitted = await submit.submit(
      { id: studentId, role: UserRole.Student },
      form.id,
      'submit-new-cycle',
    );
    expect(submitted).toMatchObject({
      status: FormStatus.submitted,
      version: 3,
    });
    const leader = {
      ...reviewerFixture(UserRole.ClassLeader),
      id: randomUUID(),
    };
    const approved = await Promise.all([
      review.review(leader, form.id, { action: 'approve' }, 'approve-1'),
      review.review(leader, form.id, { action: 'approve' }, 'approve-1'),
    ]);
    expect(approved[0]).toEqual(approved[1]);
    expect(approved[0]).toMatchObject({
      status: FormStatus.class_leader_approved,
      version: 4,
    });
    // Cùng form ở vòng duyệt mới phải được tạo notification mới.
    await review.returnToStudent(
      advisor,
      form.id,
      { reason: 'Bổ sung lần 2' },
      'reject-2',
    );
    expect(await prisma.notification.count()).toBe(2);
    expect(notifications.emitCreated).toHaveBeenCalledTimes(2);
  });

  it('replays single finalization and rejects the same key with a different score or resource', async () => {
    const form = await createForm(FormStatus.faculty_approved);
    const { finalize } = lifecycleServices();
    const admin = randomUUID();
    const results = await Promise.all([
      finalize.finalize(
        { id: admin, role: UserRole.Admin },
        form.id,
        { finalScore: 85 },
        'final-1',
      ),
      finalize.finalize(
        { id: admin, role: UserRole.Admin },
        form.id,
        { finalScore: 85 },
        'final-1',
      ),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toMatchObject({ finalScore: 85, version: 1 });
    await expect(
      finalize.finalize(
        { id: admin, role: UserRole.Admin },
        form.id,
        { finalScore: 90 },
        'final-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      finalize.finalize(
        { id: admin, role: UserRole.Admin },
        randomUUID(),
        { finalScore: 85 },
        'final-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.operationReceipt.count()).toBe(1);
  });

  it('replays bulk finalization with the original count', async () => {
    const forms = await Promise.all([
      createForm(FormStatus.faculty_approved),
      createForm(FormStatus.faculty_approved),
    ]);
    const { finalize } = lifecycleServices();
    const admin = randomUUID();
    const dto = { ids: forms.map((form) => form.id) };
    const results = await Promise.all([
      finalize.bulkFinalize({ id: admin, role: UserRole.Admin }, dto, 'bulk-1'),
      finalize.bulkFinalize({ id: admin, role: UserRole.Admin }, dto, 'bulk-1'),
    ]);
    expect(results[0].approvedCount).toBe(2);
    expect(results[1]).toEqual(results[0]);
    expect(
      (await prisma.evaluationForm.findMany()).every(
        (form) => form.version === 1,
      ),
    ).toBe(true);
  });

  it('does not include newly eligible forms when retrying finalize-by-filter', async () => {
    await createForm(FormStatus.faculty_approved);
    const { finalize } = lifecycleServices();
    const admin = randomUUID();
    const original = await finalize.finalizeByFilter(
      { id: admin, role: UserRole.Admin },
      {},
      'filter-1',
    );
    const later = await createForm(FormStatus.faculty_approved);
    expect(
      await finalize.finalizeByFilter(
        { id: admin, role: UserRole.Admin },
        {},
        'filter-1',
      ),
    ).toEqual(original);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({
        where: { id: later.id },
      }),
    ).toMatchObject({ status: FormStatus.faculty_approved, version: 0 });
    expect(
      (
        await finalize.finalizeByFilter(
          { id: admin, role: UserRole.Admin },
          {},
          'filter-new-command',
        )
      ).approvedCount,
    ).toBe(1);
  });

  it('rolls back both effects and receipt on failure, allowing a safe retry with the same key', async () => {
    const form = await createForm();
    const command = {
      actorId: studentId,
      action: 'failure-test',
      key: 'retry-1',
      input: { id: form.id },
    };
    const emitted = jest.fn();
    await expect(
      idempotentOperation(prisma as never, command, async (db, afterCommit) => {
        await db.evaluationForm.update({
          where: { id: form.id },
          data: { version: { increment: 1 } },
        });
        await createNotificationOnce(
          db,
          { userId: studentId, title: 'test', content: 'rollback' },
          ['rollback', form.id],
        );
        afterCommit(emitted);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await prisma.operationReceipt.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(emitted).not.toHaveBeenCalled();
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(0);
    const result = await idempotentOperation(prisma as never, command, (db) =>
      db.evaluationForm.update({
        where: { id: form.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      }),
    );
    expect(result.version).toBe(1);
  });

  it('creates exactly one notification per recipient/event across concurrent calls', async () => {
    const data = { userId: studentId, title: 'test', content: 'same event' };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createNotificationOnce(prisma, data, ['event-1']),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.notification.count()).toBe(1);
    await createNotificationOnce(prisma, { ...data, userId: randomUUID() }, [
      'event-1',
    ]);
    await createNotificationOnce(prisma, data, ['event-2']);
    expect(await prisma.notification.count()).toBe(3);
  });

  it('does not duplicate reminders when list and unread requests race', async () => {
    const gateway = { emitNotification: jest.fn() };
    const service = new NotificationsService(prisma as never, gateway as never);
    await Promise.all([
      service.findMine(studentId, UserRole.Student, { page: 1, limit: 10 }),
      service.countUnread(studentId, UserRole.Student),
      service.countUnread(studentId, UserRole.Student),
    ]);
    expect(await prisma.notification.count()).toBe(1);
    expect(gateway.emitNotification).toHaveBeenCalledTimes(1);
  });

  it('scopes receipts to the actor and action and normalizes object key order', async () => {
    const work = jest.fn(async () => ({ ok: true }));
    const base = { actorId: studentId, action: 'scope-test', key: 'same-key' };
    await idempotentOperation(
      prisma as never,
      { ...base, input: { a: 1, b: 2 } },
      work,
    );
    await idempotentOperation(
      prisma as never,
      { ...base, input: { b: 2, a: 1 } },
      work,
    );
    await idempotentOperation(
      prisma as never,
      { ...base, actorId: randomUUID(), input: {} },
      work,
    );
    await idempotentOperation(
      prisma as never,
      { ...base, action: 'other-action', input: {} },
      work,
    );
    expect(work).toHaveBeenCalledTimes(3);
  });

  it('accepts Idempotency-Key over HTTP and shares receipts across admin route aliases', async () => {
    const form = await createForm(FormStatus.faculty_approved);
    const adminId = randomUUID();
    const module = await Test.createTestingModule({
      controllers: [AdminTrainingEvaluationsController],
      providers: [
        {
          provide: EvaluationFinalizeService,
          useValue: lifecycleServices().finalize,
        },
        { provide: EvaluationQueryService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            id: adminId,
            role: UserRole.Admin,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    const responses = await Promise.all([
      request(app.getHttpServer())
        .patch('/api/v1/admin/evaluations/bulk-finalize')
        .set('Idempotency-Key', 'http-1')
        .send({ ids: [form.id] }),
      request(app.getHttpServer())
        .patch('/api/v1/admin/training-evaluations/bulk-finalize')
        .set('Idempotency-Key', 'http-1')
        .send({ ids: [form.id] }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body.data).toEqual(responses[1].body.data);
    expect(responses[0].body.data.approvedCount).toBe(1);
    const conflict = await request(app.getHttpServer())
      .patch('/api/v1/admin/evaluations/bulk-finalize')
      .set('Idempotency-Key', 'http-1')
      .send({ ids: [randomUUID()] });
    expect(conflict.status).toBe(409);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(1);
  });

  it('atomically rolls back a forwarded batch when saving the receipt fails, then replays its safe retry', async () => {
    const form = await createForm(FormStatus.submitted);
    const classId = (
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } })
    ).classId;
    await prisma.evaluationForm.update({
      where: { id: form.id },
      data: { classLeaderReviewedAt: new Date() },
    });
    const recipientId = randomUUID();
    let failReceipt = true;
    const client = prisma.$extends({
      query: {
        class: {
          async findFirst() {
            return { id: classId, code: 'CLS', name: 'Class' } as never;
          },
        },
        advisorAssignment: {
          async findMany() {
            return [
              {
                userId: recipientId,
                user: {
                  id: recipientId,
                  fullName: 'Advisor',
                  isActive: true,
                  deletedAt: null,
                },
              },
            ] as never;
          },
        },
        operationReceipt: {
          async create({ args, query }) {
            if (failReceipt) {
              failReceipt = false;
              throw new Error('receipt write failed');
            }
            return query(args);
          },
        },
      },
    });
    const notifications = { emitCreated: jest.fn() };
    const service = new EvaluationSubmitService(
      client as never,
      notifications as never,
      { assertClassAccess: jest.fn() } as never,
    );
    const leader = {
      ...reviewerFixture(UserRole.ClassLeader),
      id: randomUUID(),
    };
    const dto = { semesterId };
    await expect(
      service.submitClassToAdvisor(leader, classId, dto, 'forward-1'),
    ).rejects.toThrow('receipt write failed');
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.operationReceipt.count()).toBe(0);
    expect(notifications.emitCreated).not.toHaveBeenCalled();
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(0);
    const results = await Promise.all([
      service.submitClassToAdvisor(leader, classId, dto, 'forward-1'),
      service.submitClassToAdvisor(leader, classId, dto, 'forward-1'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].submittedCount).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
    expect(notifications.emitCreated).toHaveBeenCalledTimes(1);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ status: FormStatus.class_leader_approved, version: 1 });
  });

  it('does not reapply criterion scores or confirmation audit on replay', async () => {
    const form = await createForm(FormStatus.submitted);
    const criterionId = randomUUID();
    // Chỉ ghi tiêu chí trong schema test; điểm con, audit và receipt cùng chạy PostgreSQL thật.
    await pool.query(
      `INSERT INTO "${schema}".evaluation_criteria (id, code, title, max_score) VALUES ($1, $2, $3, $4)`,
      [criterionId, 'IDEMPOTENCY_TEST', 'Test criterion', 20],
    );
    const { scores, review } = lifecycleServices();
    const leader = {
      ...reviewerFixture(UserRole.ClassLeader),
      id: randomUUID(),
    };
    const dto = {
      scores: [{ criteriaCode: 'IDEMPOTENCY_TEST', classScore: 10 }],
    };
    const results = await Promise.all([
      scores.reviewScores(leader, form.id, dto, undefined, 'score-review-1'),
      scores.reviewScores(leader, form.id, dto, undefined, 'score-review-1'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ version: 1, classScore: 10 });
    const confirmations = await Promise.all([
      review.confirmReview(leader, form.id, dto, 'confirm-score-1'),
      review.confirmReview(leader, form.id, dto, 'confirm-score-1'),
    ]);
    expect(confirmations[0]).toEqual(confirmations[1]);
    expect(confirmations[0].version).toBe(3);
    expect(await prisma.formCriteriaScore.count()).toBe(1);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(3);
  });

  async function evidenceInput(evaluationFormId: string) {
    const code = `EV_${randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO "${schema}".evaluation_criteria (id, code, title, max_score) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), code, 'Evidence criterion', 20],
    );
    return {
      evaluationFormId,
      criteriaCode: code,
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/proof.jpg',
      publicId: 'evidences/proof',
    };
  }

  it('requires the form ID over HTTP and attaches only to the selected older form', async () => {
    const selected = await createForm();
    await prisma.evaluationForm.update({
      where: { id: selected.id },
      data: { createdAt: new Date('2025-01-01') },
    });
    const latest = await createForm(FormStatus.submitted);
    const body = await evidenceInput(selected.id);
    const module = await Test.createTestingModule({
      controllers: [EvidencesController],
      providers: [
        {
          provide: EvidencesService,
          useValue: new EvidencesService(prisma as never),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            id: studentId,
            role: UserRole.Student,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    const missingId = await request(app.getHttpServer())
      .post('/api/v1/evidences/link-url')
      .send({
        criteriaCode: body.criteriaCode,
        imageUrl: body.imageUrl,
        publicId: body.publicId,
      });
    expect(missingId.status).toBe(400);
    expect(await prisma.evidence.count()).toBe(0);
    const response = await request(app.getHttpServer())
      .post('/api/v1/evidences/link-url')
      .send(body);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      evaluationFormId: selected.id,
      publicId: body.publicId,
    });
    expect(
      await prisma.evidence.count({ where: { evaluationFormId: latest.id } }),
    ).toBe(0);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: selected.id },
        })
      ).version,
    ).toBe(1);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: latest.id },
        })
      ).version,
    ).toBe(0);
    const otherForm = await createForm();
    await prisma.evaluationForm.update({
      where: { id: otherForm.id },
      data: { studentId: randomUUID() },
    });
    const foreign = await request(app.getHttpServer())
      .post('/api/v1/evidences/link-url')
      .send({ ...body, evaluationFormId: otherForm.id });
    expect(foreign.status).toBe(404);
    expect(await prisma.evidence.count()).toBe(1);
  });

  it.each(['submit', 'lock'] as const)(
    'does not create evidence when the form changes concurrently by %s',
    async (change) => {
      const form = await createForm();
      const body = await evidenceInput(form.id);
      let changed = false;
      const client = prisma.$extends({
        query: {
          evaluationForm: {
            async findFirst({ args, query }) {
              const snapshot = await query(args);
              if (!changed) {
                changed = true;
                await prisma.evaluationForm.update({
                  where: { id: form.id },
                  data: {
                    version: { increment: 1 },
                    ...(change === 'submit'
                      ? { status: FormStatus.submitted }
                      : { isLocked: true }),
                  },
                });
              }
              return snapshot;
            },
          },
        },
      });
      await expect(
        new EvidencesService(client as never).linkUrl(
          { id: studentId, role: UserRole.Student },
          body,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.evidence.count()).toBe(0);
      expect(
        (
          await prisma.evaluationForm.findUniqueOrThrow({
            where: { id: form.id },
          })
        ).version,
      ).toBe(1);
    },
  );

  it('rolls back the version claim if creating evidence fails', async () => {
    const form = await createForm();
    const body = await evidenceInput(form.id);
    const client = prisma.$extends({
      query: {
        evidence: {
          async create() {
            throw new Error('evidence write failed');
          },
        },
      },
    });
    await expect(
      new EvidencesService(client as never).linkUrl(
        { id: studentId, role: UserRole.Student },
        body,
      ),
    ).rejects.toThrow('evidence write failed');
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(0);
    expect(await prisma.evidence.count()).toBe(0);
  });

  it('returns HTTP 409 for overdue student submit, allows retry after extension and replays success after expiry', async () => {
    const form = await createForm();
    await prisma.semester.update({
      where: { id: semesterId },
      data: { studentDeadline: new Date(0) },
    });
    const module = await Test.createTestingModule({
      controllers: [TrainingEvaluationsController],
      providers: [
        {
          provide: EvaluationSubmitService,
          useValue: lifecycleServices().submit,
        },
        { provide: EvaluationQueryService, useValue: {} },
        { provide: EvaluationScoreService, useValue: {} },
        { provide: EvaluationReviewService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            id: studentId,
            role: UserRole.Student,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    const submit = () =>
      request(app!.getHttpServer())
        .post(`/api/v1/training-evaluations/${form.id}/submit`)
        .set('Idempotency-Key', 'deadline-submit');
    const expired = await submit();
    expect(expired.status).toBe(409);
    expect(expired.body.message).toContain('quá hạn');
    expect(await prisma.operationReceipt.count()).toBe(0);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ status: FormStatus.draft, version: 0 });
    await prisma.semester.update({
      where: { id: semesterId },
      data: { studentDeadline: new Date('2100-01-01') },
    });
    const success = await submit();
    expect(success.status).toBe(201);
    expect(success.body.data).toMatchObject({
      status: FormStatus.submitted,
      version: 1,
    });
    await prisma.semester.update({
      where: { id: semesterId },
      data: { studentDeadline: new Date(0) },
    });
    const replay = await submit();
    expect(replay.status).toBe(201);
    expect(replay.body.data).toEqual(success.body.data);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(1);
  });

  it('does not save optional criterion scores or confirmation audit when classDeadline has passed', async () => {
    const form = await createForm(FormStatus.submitted);
    const body = await evidenceInput(form.id); // Tạo tiêu chí riêng trong schema test.
    await prisma.semester.update({
      where: { id: semesterId },
      data: { classDeadline: new Date(0) },
    });
    const { review } = lifecycleServices();
    const leader = {
      ...reviewerFixture(UserRole.ClassLeader),
      id: randomUUID(),
    };
    await expect(
      review.confirmReview(
        leader,
        form.id,
        { scores: [{ criteriaCode: body.criteriaCode, classScore: 10 }] },
        'expired-confirm',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.formCriteriaScore.count()).toBe(0);
    expect(await prisma.operationReceipt.count()).toBe(0);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({
      version: 0,
      classLeaderReviewedBy: null,
      classLeaderReviewedAt: null,
      classScore: 80,
    });
  });

  it('blocks a whole forwarding batch without notification after classDeadline', async () => {
    const form = await createForm(FormStatus.submitted);
    const classId = (
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } })
    ).classId;
    await prisma.evaluationForm.update({
      where: { id: form.id },
      data: { classLeaderReviewedAt: new Date() },
    });
    await prisma.semester.update({
      where: { id: semesterId },
      data: {
        studentDeadline: new Date('2100-01-01'),
        classDeadline: new Date(0),
      },
    });
    const recipient = randomUUID();
    const client = prisma.$extends({
      query: {
        class: {
          async findFirst() {
            return { id: classId, code: 'CLS', name: 'Class' } as never;
          },
        },
        advisorAssignment: {
          async findMany() {
            return [
              {
                userId: recipient,
                user: {
                  id: recipient,
                  fullName: 'Advisor',
                  isActive: true,
                  deletedAt: null,
                },
              },
            ] as never;
          },
        },
      },
    });
    const notifications = { emitCreated: jest.fn() };
    const service = new EvaluationSubmitService(
      client as never,
      notifications as never,
      { assertClassAccess: jest.fn() } as never,
    );
    await expect(
      service.submitClassToAdvisor(
        { ...reviewerFixture(UserRole.ClassLeader), id: randomUUID() },
        classId,
        { semesterId },
        'expired-forward',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.operationReceipt.count()).toBe(0);
    expect(notifications.emitCreated).not.toHaveBeenCalled();
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ status: FormStatus.submitted, version: 0 });
  });

  async function accessHttpApp() {
    const queries = new EvaluationQueryService(prisma as never);
    const scores = new EvaluationScoreService(prisma as never, queries, {
      invalidate: jest.fn(),
    } as never);
    const finalize = new EvaluationFinalizeService(prisma as never);
    const submissions = new EvaluationSubmitService(
      prisma as never,
      { emitCreated: jest.fn() } as never,
      queries,
    );
    const reviews = new EvaluationReviewService(
      prisma as never,
      { emitCreated: jest.fn() } as never,
      queries,
      scores,
      finalize,
    );
    const module = await Test.createTestingModule({
      controllers: [
        TrainingEvaluationsController,
        AdminTrainingEvaluationsController,
      ],
      providers: [
        { provide: EvaluationQueryService, useValue: queries },
        { provide: EvaluationScoreService, useValue: scores },
        { provide: EvaluationSubmitService, useValue: submissions },
        { provide: EvaluationReviewService, useValue: reviews },
        { provide: EvaluationFinalizeService, useValue: finalize },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = {
            id: req.headers['x-test-user'] ?? studentId,
            role: req.headers['x-test-role'] ?? UserRole.Student,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    return app;
  }
  async function accessForm() {
    const form = await createForm();
    const code = randomBytes(6).toString('hex');
    const faculty = await prisma.faculty.create({
      data: { code: `F_${code}`, name: 'Faculty' },
    });
    const major = await prisma.major.create({
      data: { code: `M_${code}`, name: 'Major', facultyId: faculty.id },
    });
    const cls = await prisma.class.create({
      data: {
        code: `C_${code}`,
        name: 'Class',
        majorId: major.id,
        enrollmentYear: 2026,
      },
    });
    await prisma.evaluationForm.update({
      where: { id: form.id },
      data: { classId: cls.id },
    });
    return { form, faculty, cls };
  }

  it('scopes HTTP reads by class/faculty assignment while keeping global admin/training reads', async () => {
    const { form, faculty, cls } = await accessForm();
    const advisorId = randomUUID(),
      facultyUserId = randomUUID(),
      leaderId = randomUUID();
    const server = (await accessHttpApp()).getHttpServer();
    const read = (role: UserRole, userId: string, route = 'summary') =>
      request(server)
        .get(`/api/v1/training-evaluations/${form.id}/${route}`)
        .set('x-test-role', role)
        .set('x-test-user', userId);
    expect((await read(UserRole.Advisor, advisorId)).status).toBe(403);
    await prisma.advisorAssignment.create({
      data: { userId: advisorId, classId: cls.id },
    });
    expect((await read(UserRole.Advisor, advisorId)).status).toBe(200);
    await prisma.advisorAssignment.deleteMany();
    expect((await read(UserRole.Advisor, advisorId)).status).toBe(403);
    expect((await read(UserRole.ClassLeader, leaderId, 'status')).status).toBe(
      403,
    );
    await prisma.classLeaderAssignment.create({
      data: { userId: leaderId, classId: cls.id },
    });
    expect((await read(UserRole.ClassLeader, leaderId, 'status')).status).toBe(
      200,
    );
    expect((await read(UserRole.Faculty, facultyUserId)).status).toBe(403);
    const otherFaculty = await prisma.faculty.create({
      data: { code: 'OTHER_FACULTY', name: 'Other' },
    });
    const assignment = await prisma.facultyAssignment.create({
      data: { userId: facultyUserId, facultyId: otherFaculty.id },
    });
    expect((await read(UserRole.Faculty, facultyUserId)).status).toBe(403);
    await prisma.facultyAssignment.update({
      where: { id: assignment.id },
      data: { facultyId: faculty.id },
    });
    expect((await read(UserRole.Faculty, facultyUserId)).status).toBe(200);
    expect((await read(UserRole.Admin, randomUUID())).status).toBe(200);
    expect((await read(UserRole.TrainingDepartment, randomUUID())).status).toBe(
      200,
    );
    expect((await read(UserRole.Student, randomUUID())).status).toBe(404);
    expect((await read(UserRole.Student, studentId)).status).toBe(200);
  });

  it('distinguishes HTTP 403 authorization failures from 409 invalid transitions without changing version', async () => {
    const { form, cls } = await accessForm();
    const leaderId = randomUUID();
    const server = (await accessHttpApp()).getHttpServer();
    const confirm = (role: UserRole) =>
      request(server)
        .post(`/api/v1/training-evaluations/${form.id}/confirm-review`)
        .set('x-test-role', role)
        .set('x-test-user', leaderId)
        .send({});
    expect((await confirm(UserRole.Student)).status).toBe(403);
    expect((await confirm(UserRole.ClassLeader)).status).toBe(403);
    await prisma.classLeaderAssignment.create({
      data: { userId: leaderId, classId: cls.id },
    });
    // Đúng role và assignment nhưng draft chưa ở bước review: lỗi workflow phải là 409.
    expect((await confirm(UserRole.ClassLeader)).status).toBe(409);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(0);
    const wrongFinalize = await request(server)
      .patch(`/api/v1/admin/evaluations/${form.id}/finalize`)
      .set('x-test-role', UserRole.Advisor)
      .send({});
    expect(wrongFinalize.status).toBe(403);
    const invalidFinalize = await request(server)
      .patch(`/api/v1/admin/evaluations/${form.id}/finalize`)
      .set('x-test-role', UserRole.Admin)
      .send({});
    expect(invalidFinalize.status).toBe(409);
    expect(await prisma.operationReceipt.count()).toBe(0);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(0);
  });

  it('checks current actor role before replaying a successful submit/finalize receipt', async () => {
    const { submit, finalize } = lifecycleServices();
    const form = await createForm();
    await submit.submit(
      { id: studentId, role: UserRole.Student },
      form.id,
      'role-check-submit',
    );
    await expect(
      submit.submit(
        { id: studentId, role: UserRole.Admin },
        form.id,
        'role-check-submit',
      ),
    ).rejects.toMatchObject({ status: 403 });
    const finalForm = await createForm(FormStatus.faculty_approved);
    const adminId = randomUUID();
    await finalize.finalize(
      { id: adminId, role: UserRole.Admin },
      finalForm.id,
      {},
      'role-check-finalize',
    );
    await expect(
      finalize.finalize(
        { id: adminId, role: UserRole.Student },
        finalForm.id,
        {},
        'role-check-finalize',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.operationReceipt.count()).toBe(2);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(1);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: finalForm.id },
        })
      ).version,
    ).toBe(1);
  });

  it('revalidates class assignment on receipt replay without reapplying a completed confirmation', async () => {
    const { form, cls } = await accessForm();
    await prisma.evaluationForm.update({
      where: { id: form.id },
      data: { status: FormStatus.submitted },
    });
    const leaderId = randomUUID();
    await prisma.classLeaderAssignment.create({
      data: { userId: leaderId, classId: cls.id },
    });
    const server = (await accessHttpApp()).getHttpServer();
    const confirm = () =>
      request(server)
        .post(`/api/v1/training-evaluations/${form.id}/confirm-review`)
        .set('x-test-role', UserRole.ClassLeader)
        .set('x-test-user', leaderId)
        .set('Idempotency-Key', 'assignment-replay')
        .send({});
    const first = await confirm();
    expect(first.status).toBe(201);
    expect(first.body.data.version).toBe(1);
    await prisma.classLeaderAssignment.deleteMany({
      where: { userId: leaderId },
    });
    expect((await confirm()).status).toBe(403);
    await prisma.classLeaderAssignment.create({
      data: { userId: leaderId, classId: cls.id },
    });
    const replay = await confirm();
    expect(replay.status).toBe(201);
    expect(replay.body.data).toEqual(first.body.data);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).version,
    ).toBe(1);
    expect(await prisma.operationReceipt.count()).toBe(1);
  });
  it('rejects a stale browser version even when requests are sequential, and validates version input', async () => {
    const form = await createForm();
    const server = (await accessHttpApp()).getHttpServer();
    const payload = {
      studentRoleType: 'NORMAL_STUDENT',
      normalStudentActivityScore: 2,
      expectedVersion: 0,
    };
    const first = await request(server)
      .patch(`/api/v1/training-evaluations/${form.id}/role-score`)
      .send(payload);
    expect(first.status).toBe(200);
    const stale = await request(server)
      .patch(`/api/v1/training-evaluations/${form.id}/role-score`)
      .send({ ...payload, normalStudentActivityScore: 3 });
    expect(stale.status).toBe(409);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ version: 1, roleScore: 2 });
    const invalid = await request(server)
      .post(`/api/v1/training-evaluations/${form.id}/submit`)
      .send({ expectedVersion: -1 });
    expect(invalid.status).toBe(400);
  });

  it('requires the full selected snapshot for bulk finalize and rolls back a stale selection', async () => {
    const a = await createForm(FormStatus.faculty_approved);
    const b = await createForm(FormStatus.faculty_approved);
    await prisma.evaluationForm.update({
      where: { id: b.id },
      data: { version: { increment: 1 } },
    });
    const server = (await accessHttpApp()).getHttpServer();
    const payload = { ids: [a.id, b.id], expectedVersions: [a, b] };
    const stale = await request(server)
      .patch('/api/v1/admin/evaluations/bulk-finalize')
      .set('x-test-role', UserRole.Admin)
      .send(payload);
    expect(stale.status).toBe(409);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: a.id } }),
    ).toMatchObject({ status: FormStatus.faculty_approved, version: 0 });
  });

  it('runs the complete HTTP workflow across student, leader, advisor, faculty and training roles', async () => {
    const { form, cls, faculty } = await accessForm();
    const actors = {
      student: studentId,
      leader: randomUUID(),
      advisor: randomUUID(),
      faculty: randomUUID(),
      training: randomUUID(),
    };
    for (const [name, id] of Object.entries(actors)) {
      const role =
        name === 'leader'
          ? UserRole.ClassLeader
          : name === 'training'
            ? UserRole.TrainingDepartment
            : (name as UserRole);
      await prisma.user.create({
        data: {
          id,
          username: `test_${id}`,
          email: `${id}@example.test`,
          passwordHash: 'test-fixture-not-used',
          fullName: name,
          role,
        },
      });
    }
    await prisma.classLeaderAssignment.create({
      data: { userId: actors.leader, classId: cls.id },
    });
    await prisma.advisorAssignment.create({
      data: { userId: actors.advisor, classId: cls.id },
    });
    await prisma.facultyAssignment.create({
      data: { userId: actors.faculty, facultyId: faculty.id },
    });
    for (const [code, maxScore] of [
      ['TC1', 20],
      ['TC2', 25],
      ['TC3', 20],
      ['TC4', 25],
      ['TC5', 10],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}".evaluation_criteria (id, code, title, max_score) VALUES ($1::uuid,$2,$2,$3) ON CONFLICT (code) DO NOTHING`,
        randomUUID(),
        code,
        maxScore,
      );
    }
    const server = (await accessHttpApp()).getHttpServer();
    const call = (
      method: 'post' | 'patch',
      url: string,
      role: UserRole,
      id: string,
      payload: object,
      key: string,
    ) =>
      request(server)[method](`/api/v1${url}`)
        .set('x-test-role', role)
        .set('x-test-user', id)
        .set('Idempotency-Key', key)
        .send(payload);
    const submitPayload = { expectedVersion: 0 };
    const submitted = await call(
      'post',
      `/training-evaluations/${form.id}/submit`,
      UserRole.Student,
      actors.student,
      submitPayload,
      'workflow-submit',
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.data).toMatchObject({
      status: FormStatus.submitted,
      version: 1,
    });
    const replay = await call(
      'post',
      `/training-evaluations/${form.id}/submit`,
      UserRole.Student,
      actors.student,
      submitPayload,
      'workflow-submit',
    );
    expect(replay.body.data).toEqual(submitted.body.data);
    const scores = [
      { criteriaCode: 'TC1', classScore: 18 },
      { criteriaCode: 'TC2', classScore: 23 },
      { criteriaCode: 'TC3', classScore: 18 },
      { criteriaCode: 'TC4', classScore: 23 },
      { criteriaCode: 'TC5', classScore: 8 },
    ];
    const leader = await call(
      'post',
      `/training-evaluations/${form.id}/confirm-review`,
      UserRole.ClassLeader,
      actors.leader,
      { scores, expectedVersion: 1 },
      'workflow-leader-confirm',
    );
    expect(leader.status).toBe(201);
    expect(leader.body.data.version).toBe(3);
    const leaderSend = await call(
      'post',
      `/training-evaluations/classes/${cls.id}/submit-to-advisor`,
      UserRole.ClassLeader,
      actors.leader,
      { semesterId, evaluationIds: [form.id] },
      'workflow-leader-send',
    );
    expect(leaderSend.status).toBe(201);
    expect(
      (
        await prisma.evaluationForm.findUniqueOrThrow({
          where: { id: form.id },
        })
      ).status,
    ).toBe(FormStatus.class_leader_approved);
    const advisor = await call(
      'post',
      `/training-evaluations/${form.id}/confirm-review`,
      UserRole.Advisor,
      actors.advisor,
      { scores, expectedVersion: 4 },
      'workflow-advisor-confirm',
    );
    expect(advisor.status).toBe(201);
    expect(advisor.body.data.version).toBe(6);
    const advisorSend = await call(
      'post',
      `/training-evaluations/classes/${cls.id}/submit-to-faculty`,
      UserRole.Advisor,
      actors.advisor,
      { semesterId, evaluationIds: [form.id] },
      'workflow-advisor-send',
    );
    expect(advisorSend.status).toBe(201);
    const facultySend = await call(
      'post',
      `/training-evaluations/faculties/${faculty.id}/submit-to-training-department`,
      UserRole.Faculty,
      actors.faculty,
      { semesterId, classId: cls.id },
      'workflow-faculty-send',
    );
    expect(facultySend.status).toBe(201);
    const finalPayload = { expectedVersion: 8 };
    const final = await call(
      'patch',
      `/training-department/evaluations/${form.id}/finalize`,
      UserRole.TrainingDepartment,
      actors.training,
      finalPayload,
      'workflow-final',
    );
    expect(final.status).toBe(200);
    expect(final.body.data).toMatchObject({
      status: FormStatus.finalized,
      version: 9,
      finalScore: 90,
    });
    const duplicate = await call(
      'patch',
      `/admin/evaluations/${form.id}/finalize`,
      UserRole.TrainingDepartment,
      actors.training,
      finalPayload,
      'workflow-final',
    );
    expect(duplicate.body.data).toEqual(final.body.data);
    expect(
      await prisma.evaluationForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).toMatchObject({ version: 9, status: FormStatus.finalized });
  });
});
