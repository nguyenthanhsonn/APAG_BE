import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  assertUserIdentifiersAvailable,
  throwBusinessUniqueConflict,
} from './business-uniqueness.helper';

describe('business uniqueness validation', () => {
  it.each([
    ['User', ['username'], 'Tên đăng nhập'],
    ['User', 'users_username_normalized_key', 'Tên đăng nhập'],
    ['User', ['email'], 'Email'],
    ['ClassStudent', ['student_code'], 'Mã sinh viên'],
    ['ClassStudent', ['student_id'], 'Sinh viên'],
    ['ClassLeaderAssignment', ['user_id'], 'Lớp trưởng'],
    ['AdvisorAssignment', ['user_id', 'class_id'], 'CVHT'],
    ['FacultyAssignment', ['user_id'], 'Tài khoản khoa'],
    ['Semester', 'semesters_single_active_key', 'tối đa một học kỳ'],
    ['Semester', ['year', 'semester'], 'Học kỳ'],
    ['EvaluationForm', ['student_id', 'semester_id'], 'Phiếu đánh giá'],
  ])(
    'translates %s unique violations including index-name targets',
    (modelName, target, expected) => {
      const error = new Prisma.PrismaClientKnownRequestError('unique failure', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { modelName, target },
      });
      expect(() => throwBusinessUniqueConflict(error)).toThrow(
        ConflictException,
      );
      expect(() => throwBusinessUniqueConflict(error)).toThrow(
        String(expected),
      );
    },
  );
  it('reads Prisma 7 adapter-pg constraint metadata when target is absent', () => {
    const error = new Prisma.PrismaClientKnownRequestError('unique failure', {
      code: 'P2002',
      clientVersion: 'test',
      meta: {
        modelName: 'Semester',
        driverAdapterError: {
          cause: {
            constraint: { index: 'semesters_single_active_key' },
            table: 'semesters',
          },
        },
      },
    });
    expect(() => throwBusinessUniqueConflict(error)).toThrow(
      'tối đa một học kỳ',
    );
  });
  it('leaves unrelated database failures to their existing handlers', () => {
    expect(() =>
      throwBusinessUniqueConflict(new Error('unavailable')),
    ).not.toThrow();
    expect(() =>
      throwBusinessUniqueConflict(
        new Prisma.PrismaClientKnownRequestError('missing', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      ),
    ).not.toThrow();
  });
  it('checks identifiers across deleted accounts and excludes the current account on update', async () => {
    const database = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          username: 'Existing',
          email: 'old@example.test',
        }),
      },
    };
    await expect(
      assertUserIdentifiersAvailable(
        database as never,
        { username: 'existing' },
        'current',
      ),
    ).rejects.toThrow('Tên đăng nhập');
    expect(database.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ username: { equals: 'existing', mode: 'insensitive' } }],
        id: { not: 'current' },
      },
      select: { username: true, email: true },
    });
  });
});
