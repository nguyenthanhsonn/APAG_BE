import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  SemesterNo,
  UserRole,
} from '../../src/generated/prisma/client';
import { resolveDatabaseUrl } from '../../src/config/database-url.helper';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Nạp biến môi trường từ projects/.env để seed dùng đúng DATABASE_URL hiện tại.
dotenv.config({ path: path.join(__dirname, '../../.env') });

const databaseUrl = resolveDatabaseUrl(process.env);
if (!databaseUrl) {
  console.error(
    'Chưa cấu hình database. Hãy set DATABASE_URL hoặc DB_HOST, DB_NAME, DB_PASS trong file .env',
  );
  process.exit(1);
}

const DEFAULT_PASSWORD = 'Password123';

async function main() {
  console.log('Đang kết nối cơ sở dữ liệu...');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('Đang băm mật khẩu mặc định...');
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    // Các tài khoản này đủ để test Auth, Student profile và RoleGuard.
    const admin = await prisma.user.upsert({
      where: { email: 'admin@csmts.edu.vn' },
      update: {
        username: 'admin',
        fullName: 'Hội đồng Học viện Admin',
        passwordHash,
        role: UserRole.admin,
        phone: '0987654321',
        dateOfBirth: new Date('1985-05-15'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'admin',
        email: 'admin@csmts.edu.vn',
        fullName: 'Hội đồng Học viện Admin',
        passwordHash,
        role: UserRole.admin,
        phone: '0987654321',
        dateOfBirth: new Date('1985-05-15'),
        isActive: true,
      },
    });

    const studentTest = await prisma.user.upsert({
      where: { email: 'student.test2@csmts.local' },
      update: {
        username: 'student.test2',
        fullName: 'Sinh viên Test Postman',
        passwordHash,
        role: UserRole.student,
        phone: '0901234567',
        dateOfBirth: new Date('2004-09-20'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'student.test2',
        email: 'student.test2@csmts.local',
        fullName: 'Sinh viên Test Postman',
        passwordHash,
        role: UserRole.student,
        phone: '0901234567',
        dateOfBirth: new Date('2004-09-20'),
        isActive: true,
      },
    });

    const studentSon = await prisma.user.upsert({
      where: { email: 'student.son@csmts.edu.vn' },
      update: {
        username: 'student.son',
        fullName: 'Nguyễn Thanh Sơn',
        passwordHash,
        role: UserRole.student,
        phone: '0912345678',
        dateOfBirth: new Date('2004-09-20'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'student.son',
        email: 'student.son@csmts.edu.vn',
        fullName: 'Nguyễn Thanh Sơn',
        passwordHash,
        role: UserRole.student,
        phone: '0912345678',
        dateOfBirth: new Date('2004-09-20'),
        isActive: true,
      },
    });

    const studentDuc = await prisma.user.upsert({
      where: { email: 'student.duc@csmts.edu.vn' },
      update: {
        username: 'student.duc',
        fullName: 'Trần Minh Đức',
        passwordHash,
        role: UserRole.student,
        phone: '0923456789',
        dateOfBirth: new Date('2004-12-10'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'student.duc',
        email: 'student.duc@csmts.edu.vn',
        fullName: 'Trần Minh Đức',
        passwordHash,
        role: UserRole.student,
        phone: '0923456789',
        dateOfBirth: new Date('2004-12-10'),
        isActive: true,
      },
    });

    const classLeader = await prisma.user.upsert({
      where: { email: 'class.leader@csmts.edu.vn' },
      update: {
        username: 'class.leader',
        fullName: 'Lớp trưởng',
        passwordHash,
        role: UserRole.class_leader,
        phone: '0934567890',
        dateOfBirth: new Date('1990-03-25'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'class.leader',
        email: 'class.leader@csmts.edu.vn',
        fullName: 'Lớp trưởng',
        passwordHash,
        role: UserRole.class_leader,
        phone: '0934567890',
        dateOfBirth: new Date('1990-03-25'),
        isActive: true,
      },
    });

    const advisor = await prisma.user.upsert({
      where: { email: 'advisor@csmts.edu.vn' },
      update: {
        username: 'advisor',
        fullName: 'Cố vấn học tập',
        passwordHash,
        role: UserRole.advisor,
        phone: '0934567891',
        dateOfBirth: new Date('1988-03-25'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'advisor',
        email: 'advisor@csmts.edu.vn',
        fullName: 'Cố vấn học tập',
        passwordHash,
        role: UserRole.advisor,
        phone: '0934567891',
        dateOfBirth: new Date('1988-03-25'),
        isActive: true,
      },
    });

    console.log('Đang seed khoa, ngành và lớp học...');
    const facultiesData = [
      { code: 'CNTT', name: 'Khoa Công nghệ thông tin' },
      { code: 'KTE', name: 'Khoa Kinh tế' },
      { code: 'DTVT', name: 'Khoa Điện tử viễn thông' },
      { code: 'NNA', name: 'Khoa Ngôn ngữ Anh' },
    ];

    const faculties: Record<string, any> = {};
    for (const f of facultiesData) {
      faculties[f.code] = await prisma.faculty.upsert({
        where: { code: f.code },
        update: {
          name: f.name,
          isActive: true,
        },
        create: {
          code: f.code,
          name: f.name,
          isActive: true,
        },
      });
    }

    const majorsData = [
      { code: 'KTPM', name: 'Kỹ thuật phần mềm', facultyCode: 'CNTT' },
      { code: 'KHMT', name: 'Khoa học máy tính', facultyCode: 'CNTT' },
      { code: 'ATTT', name: 'An toàn thông tin', facultyCode: 'CNTT' },
      { code: 'QTKD', name: 'Quản trị kinh doanh', facultyCode: 'KTE' },
      { code: 'TCNH', name: 'Tài chính ngân hàng', facultyCode: 'KTE' },
      { code: 'KT', name: 'Kế toán', facultyCode: 'KTE' },
      { code: 'DTVT', name: 'Kỹ thuật Điện tử viễn thông', facultyCode: 'DTVT' },
      { code: 'NNA', name: 'Ngôn ngữ Anh', facultyCode: 'NNA' },
    ];

    const majors: Record<string, any> = {};
    for (const m of majorsData) {
      const fac = faculties[m.facultyCode];
      if (fac) {
        majors[m.code] = await prisma.major.upsert({
          where: { code: m.code },
          update: {
            name: m.name,
            facultyId: fac.id,
            isActive: true,
          },
          create: {
            code: m.code,
            name: m.name,
            facultyId: fac.id,
            isActive: true,
          },
        });
      }
    }

    const classesData = [
      { code: 'KTPM-K18A', name: 'Kỹ thuật phần mềm K18A', majorCode: 'KTPM', enrollmentYear: 2022 },
      { code: 'KTPM-K18B', name: 'Kỹ thuật phần mềm K18B', majorCode: 'KTPM', enrollmentYear: 2022 },
      { code: 'KHMT-K18A', name: 'Khoa học máy tính K18A', majorCode: 'KHMT', enrollmentYear: 2022 },
      { code: 'ATTT-K18A', name: 'An toàn thông tin K18A', majorCode: 'ATTT', enrollmentYear: 2022 },
      { code: 'QTKD-K18A', name: 'Quản trị kinh doanh K18A', majorCode: 'QTKD', enrollmentYear: 2022 },
      { code: 'TCNH-K18A', name: 'Tài chính ngân hàng K18A', majorCode: 'TCNH', enrollmentYear: 2022 },
      { code: 'KT-K18A', name: 'Kế toán K18A', majorCode: 'KT', enrollmentYear: 2022 },
      { code: 'DTVT-K18A', name: 'Kỹ thuật Điện tử viễn thông K18A', majorCode: 'DTVT', enrollmentYear: 2022 },
      { code: 'NNA-K18A', name: 'Ngôn ngữ Anh K18A', majorCode: 'NNA', enrollmentYear: 2022 },
    ];

    const classes: Record<string, any> = {};
    for (const c of classesData) {
      const maj = majors[c.majorCode];
      if (maj) {
        classes[c.code] = await prisma.class.upsert({
          where: { code: c.code },
          update: {
            name: c.name,
            majorId: maj.id,
            enrollmentYear: c.enrollmentYear,
            isActive: true,
          },
          create: {
            code: c.code,
            name: c.name,
            majorId: maj.id,
            enrollmentYear: c.enrollmentYear,
            isActive: true,
          },
        });
      }
    }

    const studentClass = classes['KTPM-K18A'];

    console.log('Đang seed danh sách lớp và phân công hội đồng...');
    const classStudents = [
      { user: studentTest, studentCode: 'SVTEST002' },
      { user: studentSon, studentCode: 'SV20220001' },
      { user: studentDuc, studentCode: 'SV20220002' },
    ];

    for (const item of classStudents) {
      await prisma.classStudent.upsert({
        where: {
          classId_studentId: {
            classId: studentClass.id,
            studentId: item.user.id,
          },
        },
        update: {
          studentCode: item.studentCode,
        },
        create: {
          classId: studentClass.id,
          studentId: item.user.id,
          studentCode: item.studentCode,
        },
      });
    }

    await prisma.classLeaderAssignment.upsert({
      where: { userId: classLeader.id },
      update: {},
      create: {
        userId: classLeader.id,
        classId: studentClass.id,
      },
    });

    await prisma.advisorAssignment.upsert({
      where: {
        userId_classId: {
          userId: advisor.id,
          classId: studentClass.id,
        },
      },
      update: {},
      create: {
        userId: advisor.id,
        classId: studentClass.id,
      },
    });

    console.log('Đang seed học kỳ dùng cho Postman training evaluations...');
    await prisma.semester.upsert({
      where: {
        year_semester: {
          year: 2025,
          semester: SemesterNo.SEMESTER_1,
        },
      },
      update: {
        startDate: new Date('2025-09-01'),
        endDate: new Date('2026-01-15'),
        studentDeadline: new Date('2026-01-20T16:59:59.000Z'),
        classDeadline: new Date('2026-01-27T16:59:59.000Z'),
        facultyDeadline: new Date('2026-02-03T16:59:59.000Z'),
        isActive: true,
      },
      create: {
        year: 2025,
        semester: SemesterNo.SEMESTER_1,
        startDate: new Date('2025-09-01'),
        endDate: new Date('2026-01-15'),
        studentDeadline: new Date('2026-01-20T16:59:59.000Z'),
        classDeadline: new Date('2026-01-27T16:59:59.000Z'),
        facultyDeadline: new Date('2026-02-03T16:59:59.000Z'),
        isActive: true,
      },
    });

    await prisma.semester.upsert({
      where: {
        year_semester: {
          year: 2025,
          semester: SemesterNo.SEMESTER_2,
        },
      },
      update: {
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-06-15'),
        studentDeadline: new Date('2026-06-20T16:59:59.000Z'),
        classDeadline: new Date('2026-06-27T16:59:59.000Z'),
        facultyDeadline: new Date('2026-07-03T16:59:59.000Z'),
        isActive: true,
      },
      create: {
        year: 2025,
        semester: SemesterNo.SEMESTER_2,
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-06-15'),
        studentDeadline: new Date('2026-06-20T16:59:59.000Z'),
        classDeadline: new Date('2026-06-27T16:59:59.000Z'),
        facultyDeadline: new Date('2026-07-03T16:59:59.000Z'),
        isActive: true,
      },
    });

    console.log('Đang seed tiêu chí đánh giá...');
    const criteriaData = [
      { code: 'TC1', title: 'Ý thức tham gia học tập', maxScore: 20 },
      { code: 'TC2', title: 'Ý thức chấp hành điều lệ, quy chế', maxScore: 25 },
      { code: 'TC3', title: 'Ý thức tham gia hoạt động chính trị, xã hội, văn hóa, văn nghệ, thể thao', maxScore: 20 },
      { code: 'TC4', title: 'Ý thức công dân và quan hệ cộng đồng', maxScore: 25 },
      { code: 'TC5', title: 'Ý thức và kết quả tham gia công tác lớp, đoàn thể', maxScore: 10 },
    ];
    const criteria = [];
    for (const item of criteriaData) {
      const c = await prisma.evaluationCriteria.upsert({
        where: { code: item.code },
        update: { title: item.title, maxScore: item.maxScore },
        create: { code: item.code, title: item.title, maxScore: item.maxScore },
      });
      criteria.push(c);
    }

    console.log('Đang seed phiếu đánh giá...');
    const semesterForEvaluation = await prisma.semester.findFirst({
      where: { year: 2025, semester: SemesterNo.SEMESTER_2 }
    });
    
    const students = [studentTest, studentSon, studentDuc];
    const forms = [];
    if (semesterForEvaluation) {
      for (const student of students) {
        const form = await prisma.evaluationForm.upsert({
          where: {
            studentId_semesterId: {
              studentId: student.id,
              semesterId: semesterForEvaluation.id,
            }
          },
          update: {},
          create: {
            studentId: student.id,
            classId: studentClass.id,
            semesterId: semesterForEvaluation.id,
            status: 'draft',
            studentScore: 0,
          }
        });
        forms.push(form);
      }
    }

    console.log('Đang seed 10 minh chứng (Evidence)...');
    const evidenceIds = [
      'e1111111-1111-4111-a111-111111111111',
      'e2222222-2222-4222-a222-222222222222',
      'e3333333-3333-4333-a333-333333333333',
      'e4444444-4444-4444-a444-444444444444',
      'e5555555-5555-4555-a555-555555555555',
      'e6666666-6666-4666-a666-666666666666',
      'e7777777-7777-4777-a777-777777777777',
      'e8888888-8888-4888-a888-888888888888',
      'e9999999-9999-4999-a999-999999999999',
      'e0000000-0000-4000-a000-000000000000',
    ];

    const evidenceImages = [
      'https://res.cloudinary.com/demo/image/upload/v1631234567/evidence1.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234568/evidence2.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234569/evidence3.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234570/evidence4.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234571/evidence5.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234572/evidence6.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234573/evidence7.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234574/evidence8.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234575/evidence9.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1631234576/evidence10.jpg',
    ];

    if (forms.length > 0 && criteria.length > 0) {
      for (let i = 0; i < 10; i++) {
        const student = students[i % students.length];
        const form = forms[i % forms.length];
        const criterion = criteria[i % criteria.length];

        await prisma.evidence.upsert({
          where: { id: evidenceIds[i] },
          update: {
            studentId: student.id,
            evaluationFormId: form.id,
            criterionId: criterion.id,
            imageUrl: evidenceImages[i],
            publicId: `evidence_public_${i + 1}`,
          },
          create: {
            id: evidenceIds[i],
            studentId: student.id,
            evaluationFormId: form.id,
            criterionId: criterion.id,
            imageUrl: evidenceImages[i],
            publicId: `evidence_public_${i + 1}`,
          },
        });
      }
    }

    console.log('Seed hoàn tất. Mật khẩu mặc định cho tài khoản test:', DEFAULT_PASSWORD);
    console.log('Tài khoản Postman:', studentTest.username);
    console.log('Tài khoản admin:', admin.username);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Seed dữ liệu thất bại:', error);
  process.exit(1);
});
