import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../../src/generated/prisma/client';
import { resolveDatabaseUrl } from '../../src/config/database-url.helper';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const databaseUrl = resolveDatabaseUrl(process.env);
if (!databaseUrl) {
  console.error(
    'Chưa cấu hình database. Hãy set DATABASE_URL hoặc DB_HOST, DB_NAME, DB_PASS trong file .env',
  );
  process.exit(1);
}

const DEFAULT_PASSWORD = process.env.SEED_ACCOUNT_PASSWORD ?? 'Password123';
const FACULTY_CODE = 'KTE';
const FACULTY_NAME = 'Khoa Kinh tế';
const MAJOR_CODE = 'QTNI';
const MAJOR_NAME = 'Quản trị nhân lực';

type StudentSeedData = {
  studentCode: string;
  fullName: string;
  dateOfBirth: string;
  classCode: string;
};

const classesData = [
  {
    code: 'QTNI-K25-L1',
    name: 'Quản trị nhân lực K25 - Lớp 1',
    enrollmentYear: 2025,
  },
  {
    code: 'QTNI-K25-L2',
    name: 'Quản trị nhân lực K25 - Lớp 2',
    enrollmentYear: 2025,
  },
];

const studentsData: StudentSeedData[] = [
  { studentCode: '2505QTNI001', fullName: 'Võ Nguyên Khánh An', dateOfBirth: '2007-12-19', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI002', fullName: 'Phạm Đức Bình', dateOfBirth: '2007-09-11', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI003', fullName: 'Bờ Nướch Bách', dateOfBirth: '2007-08-04', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI004', fullName: 'Bùi Tuấn Cảnh', dateOfBirth: '2007-12-16', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI005', fullName: 'Nguyễn Thị Kim Châu', dateOfBirth: '2007-10-19', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI006', fullName: 'Nguyễn Minh Chiến', dateOfBirth: '2007-03-05', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI008', fullName: 'Phan Đức Hân', dateOfBirth: '2007-12-05', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI009', fullName: 'Đỗ Quang Hào', dateOfBirth: '2007-02-14', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI010', fullName: 'Nguyễn Thanh Hiền', dateOfBirth: '2007-05-28', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI011', fullName: 'Nguyễn Minh Hiếu', dateOfBirth: '2006-05-03', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI012', fullName: 'Lê Văn Hóa', dateOfBirth: '2006-03-01', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI013', fullName: 'Hồ Lê Thúy Hòa', dateOfBirth: '2007-04-28', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI014', fullName: 'Hồ Lê Thúy Hùng', dateOfBirth: '2007-04-26', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI015', fullName: 'Đoàn Lê Thị Diễm Hương', dateOfBirth: '2007-01-16', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI016', fullName: 'Lê Thu Hương', dateOfBirth: '2007-02-20', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI017', fullName: 'Nguyễn Gia Huy', dateOfBirth: '2007-01-15', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI018', fullName: 'Nguyễn Phúc Huy', dateOfBirth: '2007-12-06', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI019', fullName: 'Hứa Gia Khiêm', dateOfBirth: '2005-06-03', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI020', fullName: 'Mai Thị Cẩm Lai', dateOfBirth: '2007-07-24', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI021', fullName: 'Lê Văn Lâm', dateOfBirth: '2007-08-19', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI022', fullName: 'Nguyễn Thị Ngọc Liên', dateOfBirth: '2007-01-24', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI024', fullName: 'Nguyễn Thị Cẩm Ly', dateOfBirth: '2007-10-22', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI026', fullName: 'Nguyễn Thị Mai', dateOfBirth: '2007-10-13', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI027', fullName: 'Bùi Hồ Nguyệt Minh', dateOfBirth: '2007-01-26', classCode: 'QTNI-K25-L1' },
  { studentCode: '2505QTNI028', fullName: 'Hồ Thị Ly Na', dateOfBirth: '2007-11-11', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI029', fullName: 'Phạm Hoài Nam', dateOfBirth: '2007-07-17', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI030', fullName: 'Đinh Thị Kim Oanh', dateOfBirth: '2007-12-25', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI031', fullName: 'Hà Huy Phong', dateOfBirth: '2007-10-30', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI032', fullName: 'Võ Đăng Quang', dateOfBirth: '2007-11-17', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI033', fullName: 'Võ Đình Quang', dateOfBirth: '2007-06-22', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI034', fullName: 'Lê Tùng Đỗ Quyên', dateOfBirth: '2007-05-16', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI035', fullName: 'Dương Thị Như Quỳnh', dateOfBirth: '2007-01-06', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI036', fullName: 'Nguyễn Như Quỳnh', dateOfBirth: '2007-08-30', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI037', fullName: 'Nguyễn Như Quỳnh', dateOfBirth: '2007-04-02', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI038', fullName: 'Trần Thị Diễm Quỳnh', dateOfBirth: '2007-09-13', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI039', fullName: 'Lê Hà Tố Tâm', dateOfBirth: '2007-07-03', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI041', fullName: 'Trương Quỳnh Thư', dateOfBirth: '2007-09-15', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI042', fullName: 'Nguyễn Lê Kim Thương', dateOfBirth: '2007-06-30', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI043', fullName: 'Lê Trần Phương Thùy', dateOfBirth: '2007-12-15', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI044', fullName: 'Bùi Nguyễn Bảo Thy', dateOfBirth: '2007-05-15', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI045', fullName: 'Phan Thị Phương Thy', dateOfBirth: '2007-08-04', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI047', fullName: 'Đậu Thị Huyền Trang', dateOfBirth: '2007-07-28', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI048', fullName: 'Hà Thị Trang', dateOfBirth: '2007-09-11', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI049', fullName: 'Nguyễn Thị Khánh Trang', dateOfBirth: '2007-09-10', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI051', fullName: 'Lê Hồ Thanh Trúc', dateOfBirth: '2007-08-28', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI052', fullName: 'Ngô Thị Phương Uyên', dateOfBirth: '2007-10-15', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI053', fullName: 'Nguyễn Hữu Quốc Vũ', dateOfBirth: '2007-08-22', classCode: 'QTNI-K25-L2' },
  { studentCode: '2505QTNI055', fullName: 'Nguyễn Thị Như Ý', dateOfBirth: '2007-07-30', classCode: 'QTNI-K25-L2' },
];

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toAccountEmail(studentCode: string): string {
  return `${studentCode.toLowerCase()}@csmts.local`;
}

async function main() {
  console.log('Đang kết nối cơ sở dữ liệu...');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('Đang băm mật khẩu mặc định...');
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    console.log('Đang seed khoa, ngành và lớp QTNI khóa 25...');
    const faculty = await prisma.faculty.upsert({
      where: { code: FACULTY_CODE },
      update: { name: FACULTY_NAME, isActive: true, deletedAt: null },
      create: { code: FACULTY_CODE, name: FACULTY_NAME, isActive: true },
    });

    const major = await prisma.major.upsert({
      where: { code: MAJOR_CODE },
      update: {
        name: MAJOR_NAME,
        facultyId: faculty.id,
        isActive: true,
        deletedAt: null,
      },
      create: {
        code: MAJOR_CODE,
        name: MAJOR_NAME,
        facultyId: faculty.id,
        isActive: true,
      },
    });

    const classes: Record<string, { id: string }> = {};
    for (const item of classesData) {
      classes[item.code] = await prisma.class.upsert({
        where: { code: item.code },
        update: {
          name: item.name,
          majorId: major.id,
          enrollmentYear: item.enrollmentYear,
          isActive: true,
          deletedAt: null,
        },
        create: {
          code: item.code,
          name: item.name,
          majorId: major.id,
          enrollmentYear: item.enrollmentYear,
          isActive: true,
        },
        select: { id: true },
      });
    }

    console.log('Đang seed 48 tài khoản sinh viên và ghi danh vào lớp...');
    for (const item of studentsData) {
      const classRecord = classes[item.classCode];
      if (!classRecord) {
        throw new Error(`Không tìm thấy cấu hình lớp ${item.classCode}`);
      }

      const username = item.studentCode.toLowerCase();
      const email = toAccountEmail(item.studentCode);
      const student = await prisma.user.upsert({
        where: { email },
        update: {
          username,
          fullName: item.fullName,
          passwordHash,
          role: UserRole.student,
          dateOfBirth: toDateOnly(item.dateOfBirth),
          isActive: true,
          lockedAt: null,
          deletedAt: null,
          refreshTokenHash: null,
          refreshTokenExpiresAt: null,
        },
        create: {
          username,
          email,
          fullName: item.fullName,
          passwordHash,
          role: UserRole.student,
          dateOfBirth: toDateOnly(item.dateOfBirth),
          isActive: true,
        },
        select: { id: true },
      });

      await prisma.classStudent.upsert({
        where: { studentCode: item.studentCode },
        update: {
          classId: classRecord.id,
          studentId: student.id,
          deletedAt: null,
        },
        create: {
          classId: classRecord.id,
          studentId: student.id,
          studentCode: item.studentCode,
        },
      });
    }

    console.log('Seed tài khoản QTNI khóa 25 hoàn tất.');
    console.log('Username: mã sinh viên viết thường, ví dụ 2505qtni001');
    console.log('Email: <mã sinh viên viết thường>@csmts.local');
    console.log('Mật khẩu mặc định:', DEFAULT_PASSWORD);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Seed tài khoản QTNI khóa 25 thất bại:', error);
  process.exit(1);
});
