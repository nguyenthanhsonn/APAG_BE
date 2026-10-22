import { AdminStudentsService } from './admin-students.service';

describe('student code reservation', () => {
  it('includes soft-deleted enrollments in the precheck and refuses before creating an account', async () => {
    const prisma = {
      class: { findUnique: jest.fn().mockResolvedValue({ id: 'class' }) },
      classStudent: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ studentId: 'deleted-student' }),
      },
      $transaction: jest.fn(),
    };
    const service = new AdminStudentsService(
      prisma as never,
      {} as never,
      {} as never,
      { invalidate: jest.fn() } as never,
    );
    await expect(
      service.create({
        username: 'new-student',
        email: 'new@example.test',
        password: 'test-password',
        fullName: 'Test',
        classId: 'class',
        studentCode: 'RESERVED',
      }),
    ).rejects.toThrow('Mã sinh viên đã tồn tại');
    expect(prisma.classStudent.findFirst).toHaveBeenCalledWith({
      where: { studentCode: 'RESERVED' },
      select: { studentId: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
