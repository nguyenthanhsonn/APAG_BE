import { UserRole } from '../../../common/shared';
import { BadRequestException } from '@nestjs/common';
import {
  evaluationFixture,
  evaluationWriteMocks,
} from '../../../../test/fixtures/evaluation.fixture';
import { FormStatus } from '../../../generated/prisma/client';
import { EvaluationFinalizeService } from './evaluation-finalize.service';

describe('EvaluationFinalizeService', () => {
  const adminId = '48883133-002c-478f-8ede-b93bab87971d';
  function createService(form = evaluationFixture()) {
    const prisma = {
      evaluationForm: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        ...evaluationWriteMocks(form),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    return { prisma, service: new EvaluationFinalizeService(prisma as never) };
  }
  it('bulk finalizes valid forms and skips ids that are missing or not faculty approved', async () => {
    const { prisma, service } = createService();
    prisma.evaluationForm.findMany.mockResolvedValueOnce([
      {
        id: 'valid',
        version: 0,
        status: FormStatus.faculty_approved,
        classScore: 80,
      },
    ]);

    const result = await service.bulkFinalize(
      { id: adminId, role: UserRole.Admin },
      {
        ids: [
          'd5052f8b-a47c-4c6f-81fa-c94c2f785276',
          '00000000-0000-4000-8000-000000000000',
        ],
      },
    );

    expect(result).toMatchObject({ approvedCount: 1, skippedCount: 1 });
    expect(prisma.evaluationForm.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [
            'd5052f8b-a47c-4c6f-81fa-c94c2f785276',
            '00000000-0000-4000-8000-000000000000',
          ],
        },
        status: FormStatus.faculty_approved,
      },
      select: expect.objectContaining({
        id: true,
        version: true,
        status: true,
        classScore: true,
      }),
    });
  });

  it('finalizeByFilter finalizes all candidates that match filters', async () => {
    const { prisma, service } = createService();
    prisma.evaluationForm.findMany.mockResolvedValueOnce([
      {
        id: 'first',
        version: 0,
        status: FormStatus.faculty_approved,
        classScore: 72,
      },
      {
        id: 'second',
        version: 0,
        status: FormStatus.faculty_approved,
        classScore: 70,
      },
    ]);

    const result = await service.finalizeByFilter(
      { id: adminId, role: UserRole.Admin },
      {},
    );

    expect(result).toMatchObject({
      approvedCount: 2,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.evaluationForm.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'first', version: 0 },
        data: expect.objectContaining({
          status: FormStatus.finalized,
          version: { increment: 1 },
        }),
      }),
    );
    expect(prisma.evaluationForm.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'second', version: 0 } }),
    );
  });

  it('finalizeByFilter is idempotent when no faculty approved forms match', async () => {
    const { prisma, service } = createService();
    prisma.evaluationForm.findMany.mockResolvedValueOnce([]);

    const result = await service.finalizeByFilter(
      { id: adminId, role: UserRole.Admin },
      {},
    );

    expect(result).toEqual({
      message: 'Không có phiếu nào phù hợp để phê duyệt',
      approvedCount: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires confirmation before finalizing more than 500 forms by filter', async () => {
    const { prisma, service } = createService();
    prisma.evaluationForm.findMany.mockResolvedValueOnce(
      Array.from({ length: 501 }, (_, index) => ({
        id: `form-${index}`,
        version: 0,
        status: FormStatus.faculty_approved,
        classScore: 80,
      })),
    );

    await expect(
      service.finalizeByFilter({ id: adminId, role: UserRole.Admin }, {}),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects locked forms, unforwarded forms and missing final scores in single finalization', async () => {
    const { service, prisma } = createService();
    prisma.evaluationForm.findUnique
      .mockResolvedValueOnce(
        evaluationFixture({
          status: FormStatus.faculty_approved,
          isLocked: true,
        }),
      )
      .mockResolvedValueOnce(
        evaluationFixture({
          status: FormStatus.class_approved,
          classScore: 80,
        }),
      )
      .mockResolvedValueOnce(
        evaluationFixture({ status: FormStatus.faculty_approved }),
      );
    await expect(
      service.finalize({ id: adminId, role: UserRole.Admin }, 'form', {}),
    ).rejects.toThrow('đã bị khóa');
    await expect(
      service.finalize({ id: adminId, role: UserRole.Admin }, 'form', {}),
    ).rejects.toThrow(
      'Không thể chuyển phiếu từ class_approved sang finalized',
    );
    await expect(
      service.finalize({ id: adminId, role: UserRole.Admin }, 'form', {}),
    ).rejects.toThrow('chưa có điểm lớp');
    expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
  });

  it('honors an explicit final score and keeps the response mapping', async () => {
    const { service, prisma } = createService();
    prisma.evaluationForm.findUnique.mockResolvedValueOnce(
      evaluationFixture({
        status: FormStatus.faculty_approved,
        classScore: 80,
      }),
    );

    const result = await service.finalize(
      { id: adminId, role: UserRole.Admin },
      'form',
      { finalScore: 75 },
    );
    expect(result).toMatchObject({
      status: 'finalized',
      finalScore: 75,
      classification: 'Khá',
    });
  });

  it('preserves the legacy null-to-zero fallback in batch finalization', async () => {
    const { service, prisma } = createService();
    prisma.evaluationForm.findMany.mockResolvedValueOnce([
      {
        id: 'form',
        version: 0,
        status: FormStatus.faculty_approved,
        classScore: null,
      },
    ]);
    await service.bulkFinalize(
      { id: adminId, role: UserRole.Admin },
      { ids: ['form'] },
    );
    expect(prisma.evaluationForm.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ finalScore: 0, rank: 'poor' }),
      }),
    );
  });

  it('preserves student scores and the lock flag when reopening', async () => {
    const form = evaluationFixture({
      status: FormStatus.finalized,
      isLocked: true,
    });
    const { service, prisma } = createService(form);
    prisma.evaluationForm.findUnique.mockResolvedValueOnce(form);

    const result = await service.reopen(
      { id: adminId, role: UserRole.Admin },
      'form',
    );
    expect(result).toMatchObject({
      status: FormStatus.draft,
      isLocked: true,
      studyScore: 20,
      classScore: null,
      finalScore: null,
    });
  });

  it('validates every candidate before starting any batch writes', async () => {
    const { service, prisma } = createService();
    prisma.evaluationForm.findMany.mockResolvedValueOnce([
      {
        id: 'valid',
        version: 0,
        status: FormStatus.faculty_approved,
        classScore: 80,
      },
      {
        id: 'invalid',
        version: 0,
        status: FormStatus.submitted,
        classScore: 80,
      },
    ]);
    await expect(
      service.bulkFinalize(
        { id: adminId, role: UserRole.Admin },
        { ids: ['valid', 'invalid'] },
      ),
    ).rejects.toThrow('Không thể chuyển phiếu từ submitted sang finalized');
    expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not allow the legacy review route to skip approval steps', async () => {
    const { service, prisma } = createService();
    await expect(
      service.finalizeReviewedForm(
        { id: adminId, role: UserRole.Admin },
        {
          id: 'form',
          version: 0,
          status: FormStatus.class_approved,
          classScore: 80,
          semester: evaluationFixture().semester,
        },
      ),
    ).rejects.toThrow(
      'Không thể chuyển phiếu từ class_approved sang finalized',
    );
    expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
  });
  it('keeps final approval available to admin after the preceding stages have expired', async () => {
    const form = evaluationFixture({
      status: FormStatus.faculty_approved,
      classScore: 80,
      semester: {
        ...evaluationFixture().semester,
        studentDeadline: new Date(0),
        classDeadline: new Date(0),
        facultyDeadline: new Date(0),
      },
    });
    const { service, prisma } = createService(form);
    prisma.evaluationForm.findUnique.mockResolvedValueOnce(form);
    expect(
      await service.finalize(
        { id: adminId, role: UserRole.Admin },
        form.id,
        {},
      ),
    ).toMatchObject({
      status: FormStatus.finalized,
      finalScore: 80,
      version: 1,
    });
  });
});
