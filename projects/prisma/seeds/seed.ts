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

const USER_PASSWORD = '12345678';
const ADMIN_PASSWORD = 'Password123';

async function main() {
  console.log('Đang kết nối cơ sở dữ liệu...');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('Đang băm mật khẩu tài khoản mẫu...');
    const userPasswordHash = await bcrypt.hash(USER_PASSWORD, 10);
    const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // Các tài khoản này đủ để test đầy đủ luồng theo từng role.
    const admin = await prisma.user.upsert({
      where: { email: 'admin@csmts.edu.vn' },
      update: {
        username: 'admin',
        fullName: 'Quản trị hệ thống',
        passwordHash: adminPasswordHash,
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
        fullName: 'Quản trị hệ thống',
        passwordHash: adminPasswordHash,
        role: UserRole.admin,
        phone: '0987654321',
        dateOfBirth: new Date('1985-05-15'),
        isActive: true,
      },
    });

    const studentDucDang = await prisma.user.upsert({
      where: { email: 'ducdang@csmts.local' },
      update: {
        username: 'ducdang',
        fullName: 'Đức Đặng',
        passwordHash: userPasswordHash,
        role: UserRole.student,
        phone: '0901234567',
        dateOfBirth: new Date('2004-09-20'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'ducdang',
        email: 'ducdang@csmts.local',
        fullName: 'Đức Đặng',
        passwordHash: userPasswordHash,
        role: UserRole.student,
        phone: '0901234567',
        dateOfBirth: new Date('2004-09-20'),
        isActive: true,
      },
    });

    const classLeader = await prisma.user.upsert({
      where: { email: 'dangduc@csmts.local' },
      update: {
        username: 'dangduc',
        fullName: 'Đặng Đức - Lớp trưởng',
        passwordHash: userPasswordHash,
        role: UserRole.class_leader,
        phone: '0934567890',
        dateOfBirth: new Date('1990-03-25'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'dangduc',
        email: 'dangduc@csmts.local',
        fullName: 'Đặng Đức - Lớp trưởng',
        passwordHash: userPasswordHash,
        role: UserRole.class_leader,
        phone: '0934567890',
        dateOfBirth: new Date('1990-03-25'),
        isActive: true,
      },
    });

    const advisor = await prisma.user.upsert({
      where: { email: 'cvht@csmts.local' },
      update: {
        username: 'cvht',
        fullName: 'Cố vấn học tập',
        passwordHash: userPasswordHash,
        role: UserRole.advisor,
        phone: '0934567891',
        dateOfBirth: new Date('1988-03-25'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'cvht',
        email: 'cvht@csmts.local',
        fullName: 'Cố vấn học tập',
        passwordHash: userPasswordHash,
        role: UserRole.advisor,
        phone: '0934567891',
        dateOfBirth: new Date('1988-03-25'),
        isActive: true,
      },
    });

    const facultyUser = await prisma.user.upsert({
      where: { email: 'khoa1@csmts.local' },
      update: {
        username: 'khoa1',
        fullName: 'Tài khoản Khoa',
        passwordHash: userPasswordHash,
        role: UserRole.faculty,
        phone: '0934567892',
        dateOfBirth: new Date('1986-06-12'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'khoa1',
        email: 'khoa1@csmts.local',
        fullName: 'Tài khoản Khoa',
        passwordHash: userPasswordHash,
        role: UserRole.faculty,
        phone: '0934567892',
        dateOfBirth: new Date('1986-06-12'),
        isActive: true,
      },
    });

    const trainingDepartment = await prisma.user.upsert({
      where: { email: 'pdt@csmts.local' },
      update: {
        username: 'pdt',
        fullName: 'Phòng Đào tạo',
        passwordHash: userPasswordHash,
        role: UserRole.training_department,
        phone: '0934567893',
        dateOfBirth: new Date('1984-08-20'),
        isActive: true,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
      create: {
        username: 'pdt',
        email: 'pdt@csmts.local',
        fullName: 'Phòng Đào tạo',
        passwordHash: userPasswordHash,
        role: UserRole.training_department,
        phone: '0934567893',
        dateOfBirth: new Date('1984-08-20'),
        isActive: true,
      },
    });

    console.log('Đang seed khoa, ngành và lớp học...');
    const facultiesData = [
      { code: 'LKHLN', name: 'Khoa Luật và Khoa học liên ngành' },
      { code: 'HCQT', name: 'Khoa Hành chính và Quản trị' },
      {
        code: 'QLPTKTXH',
        name: 'Khoa Quản lý phát triển kinh tế và xã hội',
      },
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
      { code: 'LKHLN_LHO', name: 'Luật', facultyCode: 'LKHLN' },
      {
        code: 'LKHLN_TTR',
        name: 'Luật - chuyên ngành Thanh tra',
        facultyCode: 'LKHLN',
      },
      { code: 'HCQT_QTN', name: 'Quản trị nhân lực', facultyCode: 'HCQT' },
      { code: 'HCQT_QTV', name: 'Quản trị văn phòng', facultyCode: 'HCQT' },
      { code: 'HCQT_QLN', name: 'Quản lý nhà nước', facultyCode: 'HCQT' },
      { code: 'QLPTKTXH_KTE', name: 'Kinh tế', facultyCode: 'QLPTKTXH' },
      {
        code: 'QLPTKTXH_QTDVDL',
        name: 'Quản trị dịch vụ du lịch và lữ hành',
        facultyCode: 'QLPTKTXH',
      },
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

    await prisma.major.updateMany({
      where: {
        code: {
          in: ['LKHLN_QTV', 'LKHLN_QTN', 'LKHLN_QLN', 'QLPTKTXH_DLH'],
        },
      },
      data: {
        isActive: false,
      },
    });

    const classesData = [
      { code: '2205LHOC', name: 'Lớp 2205LHOC', majorCode: 'LKHLN_LHO', enrollmentYear: 2022 },
      { code: '2205TTRB', name: 'Lớp 2205TTRB', majorCode: 'LKHLN_TTR', enrollmentYear: 2022 },
      { code: '2305LHOD', name: 'Lớp 2305LHOD', majorCode: 'LKHLN_LHO', enrollmentYear: 2023 },
      { code: '2305TTRD', name: 'Lớp 2305TTRD', majorCode: 'LKHLN_TTR', enrollmentYear: 2023 },
      { code: '2305TTRE', name: 'Lớp 2305TTRE', majorCode: 'LKHLN_TTR', enrollmentYear: 2023 },
      { code: '2405TTRD', name: 'Lớp 2405TTRD', majorCode: 'LKHLN_TTR', enrollmentYear: 2024 },
      { code: '2405TTRE', name: 'Lớp 2405TTRE', majorCode: 'LKHLN_TTR', enrollmentYear: 2024 },
      { code: '2405LHOG', name: 'Lớp 2405LHOG', majorCode: 'LKHLN_LHO', enrollmentYear: 2024 },
      { code: '2505TTRD', name: 'Lớp 2505TTRD', majorCode: 'LKHLN_TTR', enrollmentYear: 2025 },
      { code: '2505TTRE', name: 'Lớp 2505TTRE', majorCode: 'LKHLN_TTR', enrollmentYear: 2025 },
      { code: '2505LHOH', name: 'Lớp 2505LHOH', majorCode: 'LKHLN_LHO', enrollmentYear: 2025 },
      { code: '2205QTND', name: 'Lớp 2205QTND', majorCode: 'HCQT_QTN', enrollmentYear: 2022 },
      { code: '2305QTNH', name: 'Lớp 2305QTNH', majorCode: 'HCQT_QTN', enrollmentYear: 2023 },
      { code: '2405QTNG', name: 'Lớp 2405QTNG', majorCode: 'HCQT_QTN', enrollmentYear: 2024 },
      { code: '2505QTNI', name: 'Lớp 2505QTNI', majorCode: 'HCQT_QTN', enrollmentYear: 2025 },
      { code: '2205QTVD', name: 'Lớp 2205QTVD', majorCode: 'HCQT_QTV', enrollmentYear: 2022 },
      { code: '2305QTVG', name: 'Lớp 2305QTVG', majorCode: 'HCQT_QTV', enrollmentYear: 2023 },
      { code: '2405QTVL', name: 'Lớp 2405QTVL', majorCode: 'HCQT_QTV', enrollmentYear: 2024 },
      { code: '2505QTVI', name: 'Lớp 2505QTVI', majorCode: 'HCQT_QTV', enrollmentYear: 2025 },
      { code: '2205QLNG', name: 'Lớp 2205QLNG', majorCode: 'HCQT_QLN', enrollmentYear: 2022 },
      { code: '2305QLNO', name: 'Lớp 2305QLNO', majorCode: 'HCQT_QLN', enrollmentYear: 2023 },
      { code: '2405QLNQ', name: 'Lớp 2405QLNQ', majorCode: 'HCQT_QLN', enrollmentYear: 2024 },
      { code: '2505QLNI', name: 'Lớp 2505QLNI', majorCode: 'HCQT_QLN', enrollmentYear: 2025 },
      { code: '2405KTEI', name: 'Lớp 2405KTEI', majorCode: 'QLPTKTXH_KTE', enrollmentYear: 2024 },
      { code: '2505KTEI', name: 'Lớp 2505KTEI', majorCode: 'QLPTKTXH_KTE', enrollmentYear: 2025 },
      { code: '2505DLHC', name: 'Lớp 2505DLHC', majorCode: 'QLPTKTXH_QTDVDL', enrollmentYear: 2025 },
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

    const studentClass = classes['2205LHOC'];

    console.log('Đang seed danh sách lớp và phân công hội đồng...');
    const classStudents = [
      { user: studentDucDang, studentCode: 'SV20220001' },
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

    await prisma.facultyAssignment.upsert({
      where: { userId: facultyUser.id },
      update: {
        facultyId: faculties.LKHLN.id,
      },
      create: {
        userId: facultyUser.id,
        facultyId: faculties.LKHLN.id,
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
    
    const students = [studentDucDang];
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

    console.log('Seed hoàn tất.');
    console.log('Tài khoản lớp trưởng:', classLeader.username, '/', USER_PASSWORD);
    console.log('Tài khoản CVHT:', advisor.username, '/', USER_PASSWORD);
    console.log('Tài khoản khoa:', facultyUser.username, '/', USER_PASSWORD);
    console.log('Tài khoản PĐT:', trainingDepartment.username, '/', USER_PASSWORD);
    console.log('Tài khoản sinh viên:', studentDucDang.username, '/', USER_PASSWORD);
    console.log('Tài khoản admin:', admin.username, '/', ADMIN_PASSWORD);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Seed dữ liệu thất bại:', error);
  process.exit(1);
});
