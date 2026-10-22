import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { UsersService } from '../src/modules/users/users.service';
import { EvaluationAccessPolicy } from '../src/modules/training-evaluations/domain/evaluation-access.policy';
import { UserRole } from '../src/common/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConflictException } from '@nestjs/common';
import { PrismaClient, SemesterNo } from '../src/generated/prisma/client';
import { AdminSemestersService } from '../src/modules/semesters/admin-semesters.service';
import { EvaluationSubmitService } from '../src/modules/training-evaluations/application/evaluation-submit.service';
import {
  assertUserIdentifiersAvailable,
  throwBusinessUniqueConflict,
} from '../src/common/helpers/business-uniqueness.helper';

const postgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;
postgres('database business invariants', () => {
  const schema = `business_invariants_${randomBytes(8).toString('hex')}`;
  const tables = [
    'users',
    'class_students',
    'class_leader_assignments',
    'advisor_assignments',
    'faculty_assignments',
    'semesters',
    'evaluation_forms',
  ];
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 6,
      connectionTimeoutMillis: 5000,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    // Copy unique/check indexes của DB đã migrate, không copy FK/dữ liệu nghiệp vụ.
    for (const table of tables)
      await pool.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    for (const [type, table, column, fallback] of [
      ['SemesterNo', 'semesters', 'semester', null],
      ['UserRole', 'users', 'role', 'student'],
      ['FormStatus', 'evaluation_forms', 'status', 'draft'],
      ['EvalRank', 'evaluation_forms', 'rank', null],
    ]) {
      const labels = await pool.query(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=$1 ORDER BY e.enumsortorder`,
        [type],
      );
      await pool.query(
        `CREATE TYPE "${schema}"."${type}" AS ENUM (${labels.rows.map((row) => `'${String(row.enumlabel).replace(/'/g, "''")}'`).join(',')})`,
      );
      await pool.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`,
      );
      await pool.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" TYPE "${schema}"."${type}" USING "${column}"::text::"${schema}"."${type}"`,
      );
      if (fallback)
        await pool.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" SET DEFAULT '${fallback}'::"${schema}"."${type}"`,
        );
    }
    // Sau rollout local, LIKE INCLUDING ALL cũng clone hai index mới với tên tự sinh.
    // Bỏ đúng index của migration trong schema test rồi chạy migration từ trạng thái trước rollout,
    // tránh hai expression index tương đương khiến lỗi unique mang tên clone users_lower_idx.
    const newIndexes = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND ((tablename='users' AND indexdef LIKE '%lower(btrim%') OR (tablename='semesters' AND indexdef LIKE '%WHERE (is_active = true)%'))`,
      [schema],
    );
    for (const { indexname } of newIndexes.rows) {
      await pool.query(
        `DROP INDEX "${schema}"."${String(indexname).replace(/"/g, '""')}"`,
      );
    }
    // Chạy đúng SQL migration mới trong schema test; không apply vào public/local nghiệp vụ.
    const migration = readFileSync(
      resolve(
        __dirname,
        '../prisma/schema/migrations/20261020030000_enforce_business_invariants/migration.sql',
      ),
      'utf8',
    ).replace(/ON "(users|semesters)"/g, `ON "${schema}"."$1"`);
    await pool.query(migration);
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  });
  afterEach(async () => {
    await pool.query(
      `TRUNCATE ${tables.map((t) => `"${schema}"."${t}"`).join(',')}`,
    );
  });
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
  async function assertOneWinner(operations: Array<Promise<unknown>>) {
    const outcomes = await Promise.allSettled(operations);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = outcomes.find((r) => r.status === 'rejected');
    if (failure?.status === 'rejected')
      expect(failure.reason.code).toBe('23505');
    else throw new Error('Expected a database uniqueness violation');
  }
  const insertForm = (student: string, semester: string) =>
    pool.query(
      `INSERT INTO "${schema}".evaluation_forms (student_id,class_id,semester_id,updated_at) VALUES ($1,$2,$3,now())`,
      [student, randomUUID(), semester],
    );
  const insertUser = (username: string) =>
    pool.query(
      `INSERT INTO "${schema}".users (username,email,password_hash,full_name,updated_at) VALUES ($1,$2,'test-only-hash','Test',now())`,
      [username, `${randomUUID()}@example.test`],
    );
  const assignment = (table: string, user: string, target: string) =>
    pool.query(
      `INSERT INTO "${schema}"."${table}" (user_id,"${table === 'faculty_assignments' ? 'faculty_id' : 'class_id'}") VALUES ($1,$2)`,
      [user, target],
    );
  const enrollment = (user: string, code: string, deleted = false) =>
    pool.query(
      `INSERT INTO "${schema}".class_students (student_id,class_id,student_code,deleted_at) VALUES ($1,$2,$3,$4)`,
      [user, randomUUID(), code, deleted ? new Date() : null],
    );

  it('enforces one evaluation/student/semester even when application validation is bypassed', async () => {
    const student = randomUUID(),
      semester = randomUUID();
    await assertOneWinner([
      insertForm(student, semester),
      insertForm(student, semester),
    ]);
    await insertForm(student, randomUUID());
    await insertForm(randomUUID(), semester);
  });
  it('enforces one class per leader, while allowing multiple leaders in a class', async () => {
    const user = randomUUID(),
      classId = randomUUID();
    await assertOneWinner([
      assignment('class_leader_assignments', user, classId),
      assignment('class_leader_assignments', user, randomUUID()),
    ]);
    await assignment('class_leader_assignments', randomUUID(), classId);
  });
  it('enforces advisor pair uniqueness without forbidding one advisor across different classes', async () => {
    const user = randomUUID(),
      classId = randomUUID();
    await assertOneWinner([
      assignment('advisor_assignments', user, classId),
      assignment('advisor_assignments', user, classId),
    ]);
    await assignment('advisor_assignments', user, randomUUID());
    await assignment('advisor_assignments', randomUUID(), classId);
  });
  it('enforces one faculty per faculty account without limiting accounts per faculty', async () => {
    const user = randomUUID(),
      faculty = randomUUID();
    await assertOneWinner([
      assignment('faculty_assignments', user, faculty),
      assignment('faculty_assignments', user, randomUUID()),
    ]);
    await assignment('faculty_assignments', randomUUID(), faculty);
  });
  it('enforces normalized username uniqueness for SQL writers outside the application', async () => {
    await assertOneWinner([insertUser(' User.Name '), insertUser('user.name')]);
    await insertUser('another.user');
  });
  it('reserves studentCode after soft delete and enforces one enrollment per student', async () => {
    await enrollment(randomUUID(), 'CODE', true);
    await expect(enrollment(randomUUID(), 'CODE')).rejects.toMatchObject({
      code: '23505',
    });
    const user = randomUUID();
    await assertOneWinner([
      enrollment(user, 'CODE_A'),
      enrollment(user, 'CODE_B'),
    ]);
  });

  async function semester(year: number, active = false) {
    return prisma.semester.create({
      data: {
        year,
        semester: SemesterNo.SEMESTER_1,
        startDate: new Date(`${year}-01-01`),
        endDate: new Date(`${year}-06-01`),
        isActive: active,
      },
    });
  }
  it('allows zero active/multiple inactive semesters but rejects a concurrent second active semester in SQL', async () => {
    const a = await semester(2025),
      b = await semester(2026);
    await assertOneWinner(
      [a, b].map((row) =>
        pool.query(
          `UPDATE "${schema}".semesters SET is_active=true WHERE id=$1`,
          [row.id],
        ),
      ),
    );
    expect(await prisma.semester.count({ where: { isActive: true } })).toBe(1);
    const inactive = await prisma.semester.findFirstOrThrow({
      where: { isActive: false },
    });
    const violation = await prisma.semester
      .update({ where: { id: inactive.id }, data: { isActive: true } })
      .catch((error) => error);
    expect(() => throwBusinessUniqueConflict(violation)).toThrow(
      'tối đa một học kỳ',
    );
  });
  it('serializes concurrent application activation and keeps form locks consistent with the winner', async () => {
    const a = await semester(2025),
      b = await semester(2026);
    await insertForm(randomUUID(), a.id);
    await insertForm(randomUUID(), b.id);
    // Notification recipients outside this invariant are empty; actual semester/form queries remain real.
    const client = prisma.$extends({
      query: {
        user: {
          async findMany() {
            return [];
          },
        },
      },
    });
    const service = new AdminSemestersService(
      client as never,
      { emitRefresh: jest.fn() } as never,
    );
    await Promise.all([
      service.toggleActive(a.id, true),
      service.update(b.id, { isActive: true }),
    ]);
    const active = await prisma.semester.findMany({
      where: { isActive: true },
    });
    expect(active).toHaveLength(1);
    const forms = await prisma.evaluationForm.findMany();
    expect(
      forms.every(
        (form) => form.isLocked === (form.semesterId !== active[0]!.id),
      ),
    ).toBe(true);
  });
  it('returns 409 on a racing application create instead of leaking P2002 as 500', async () => {
    await semester(2025);
    const student = randomUUID();
    await enrollment(student, 'APP_TEST');
    // Barrier forces both prechecks to see no existing form.
    let reads = 0;
    let release!: () => void;
    const ready = new Promise<void>((r) => {
      release = r;
    });
    const timeout = setTimeout(release, 3000);
    timeout.unref();
    const client = prisma.$extends({
      query: {
        evaluationForm: {
          async findUnique({ args, query }) {
            const row = await query(args);
            reads++;
            if (reads === 2) release();
            if (reads <= 2) await ready;
            return row;
          },
        },
      },
    });
    const service = new EvaluationSubmitService(
      client as never,
      {} as never,
      {} as never,
    );
    try {
      const results = await Promise.allSettled([
        service.create(
          { id: student, role: UserRole.Student },
          { academicYear: '2025-2026', semester: 'HK1' },
        ),
        service.create(
          { id: student, role: UserRole.Student },
          { academicYear: '2025-2026', semester: 'HK1' },
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected');
      if (failure?.status === 'rejected')
        expect(failure.reason).toBeInstanceOf(ConflictException);
      expect(await prisma.evaluationForm.count()).toBe(1);
      await expect(
        service.create(
          { id: student, role: UserRole.Student },
          { academicYear: '2025-2026', semester: 'HK1' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    } finally {
      clearTimeout(timeout);
    }
  });
  it('prechecks a reserved username including soft-deleted accounts and translates the real constraint error', async () => {
    await insertUser('reserved');
    await prisma.user.updateMany({ data: { deletedAt: new Date() } });
    await expect(
      assertUserIdentifiersAvailable(prisma, { username: 'reserved' }),
    ).rejects.toBeInstanceOf(ConflictException);
    try {
      await prisma.user.create({
        data: {
          username: 'RESERVED',
          email: 'new@example.test',
          fullName: 'Test',
          passwordHash: 'test-only-hash',
        },
      });
      throw new Error('Expected unique failure');
    } catch (error) {
      expect(() => throwBusinessUniqueConflict(error)).toThrow('Tên đăng nhập');
    }
  });

  it('refuses migration on dirty active data without deleting rows or leaving a partial index', async () => {
    const dirty = `${schema}_dirty`;
    const connection = await pool.connect();
    try {
      await connection.query(`CREATE SCHEMA "${dirty}"`);
      for (const table of ['users', 'semesters'])
        await connection.query(
          `CREATE TABLE "${dirty}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS)`,
        );
      await connection.query(
        `INSERT INTO "${dirty}".semesters (year,semester,start_date,end_date,is_active) VALUES (2025,'1','2025-01-01','2025-06-01',true),(2025,'2','2025-07-01','2025-12-01',true)`,
      );
      const migration = readFileSync(
        resolve(
          __dirname,
          '../prisma/schema/migrations/20261020030000_enforce_business_invariants/migration.sql',
        ),
        'utf8',
      ).replace(/ON "(users|semesters)"/g, `ON "${dirty}"."$1"`);
      await expect(connection.query(migration)).rejects.toMatchObject({
        code: '23505',
      });
      await connection.query('ROLLBACK');
      const rows = await connection.query(
        `SELECT count(*)::int AS count FROM "${dirty}".semesters WHERE is_active`,
      );
      expect(rows.rows[0].count).toBe(2);
      const indexes = await connection.query(
        'SELECT indexname FROM pg_indexes WHERE schemaname=$1',
        [dirty],
      );
      expect(indexes.rows).toEqual([]);
    } finally {
      await connection.query('ROLLBACK');
      await connection.query(`DROP SCHEMA IF EXISTS "${dirty}" CASCADE`);
      connection.release();
    }
  });

  it('removes finalization privilege from an older admin token immediately after a database role change', async () => {
    const user = await prisma.user.create({
      data: {
        username: 'current_role',
        email: 'current-role@example.test',
        fullName: 'Test',
        passwordHash: 'test-only-hash',
        role: 'admin',
      },
    });
    const strategy = new JwtStrategy(
      { getOrThrow: () => 'test-only-secret' } as never,
      new UsersService(prisma as never),
      { isTokenRevoked: async () => false } as never,
    );
    const token = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: UserRole.Admin,
      jti: randomUUID(),
    };
    expect(
      EvaluationAccessPolicy.canFinalize(await strategy.validate(token)),
    ).toBe(true);
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'student' },
    });
    const principal = await strategy.validate(token);
    expect(principal.role).toBe(UserRole.Student);
    expect(EvaluationAccessPolicy.canFinalize(principal)).toBe(false);
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    await expect(strategy.validate(token)).rejects.toMatchObject({
      status: 401,
    });
  });
});
