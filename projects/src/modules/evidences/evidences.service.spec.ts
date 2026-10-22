import { UserRole } from '../../common/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FormStatus } from '../../generated/prisma/client';
import { EvidencesService } from './evidences.service';

const dto = {
  evaluationFormId: 'selected-form',
  criteriaCode: 'I.1',
  imageUrl: 'https://res.cloudinary.com/demo/image/upload/proof.jpg',
  publicId: 'proof',
};
function setup(overrides = {}) {
  const form = {
    id: 'selected-form',
    studentId: 'student',
    version: 3,
    status: FormStatus.draft,
    isLocked: false,
    ...overrides,
  };
  const record = {
    id: 'evidence',
    studentId: 'student',
    evaluationFormId: form.id,
    criterionId: 'criterion',
    criterion: { id: 'criterion', code: 'I.1', title: 'Criterion' },
    imageUrl: dto.imageUrl,
    publicId: dto.publicId,
  };
  const prisma = {
    evaluationForm: {
      findFirst: jest.fn().mockResolvedValue(form),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    evaluationCriteria: {
      findFirst: jest.fn().mockResolvedValue({ id: 'criterion' }),
    },
    evidence: {
      create: jest.fn().mockResolvedValue(record),
      delete: jest.fn().mockResolvedValue(record),
      findFirst: jest.fn().mockResolvedValue({ evaluationFormId: form.id }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  return { prisma, form, service: new EvidencesService(prisma as never) };
}

describe('EvidencesService explicit evaluation form', () => {
  it.each([FormStatus.draft, FormStatus.rejected])(
    'links to the requested owned %s form without choosing the latest',
    async (status) => {
      const { service, prisma } = setup({ status });
      expect(
        await service.linkUrl({ id: 'student', role: UserRole.Student }, dto),
      ).toMatchObject({
        evaluationFormId: dto.evaluationFormId,
      });
      expect(prisma.evaluationForm.findFirst).toHaveBeenCalledWith({
        where: { id: dto.evaluationFormId, studentId: 'student' },
        select: {
          id: true,
          studentId: true,
          version: true,
          status: true,
          isLocked: true,
        },
      });
      expect(prisma.evaluationForm.updateMany).toHaveBeenCalledWith({
        where: { id: dto.evaluationFormId, version: 3 },
        data: { version: { increment: 1 } },
      });
      expect(prisma.evidence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            studentId: 'student',
            evaluationFormId: dto.evaluationFormId,
            criterionId: 'criterion',
            imageUrl: dto.imageUrl,
            publicId: dto.publicId,
          },
        }),
      );
    },
  );

  it('does not fall back to another form when the requested form is missing or belongs to someone else', async () => {
    const { service, prisma } = setup();
    prisma.evaluationForm.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.linkUrl({ id: 'student', role: UserRole.Student }, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.evaluationForm.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.evidence.create).not.toHaveBeenCalled();
  });

  it.each(
    Object.values(FormStatus).filter(
      (status) =>
        !([FormStatus.draft, FormStatus.rejected] as FormStatus[]).includes(
          status,
        ),
    ),
  )('rejects linking to a %s form', async (status) => {
    const { service, prisma } = setup({ status });
    await expect(
      service.linkUrl({ id: 'student', role: UserRole.Student }, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.evidence.create).not.toHaveBeenCalled();
  });

  it('rejects a locked draft', async () => {
    const { service, prisma } = setup({ isLocked: true });
    await expect(
      service.linkUrl({ id: 'student', role: UserRole.Student }, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.evidence.create).not.toHaveBeenCalled();
  });

  it('requires an active criterion before claiming the form version', async () => {
    const { service, prisma } = setup();
    prisma.evaluationCriteria.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.linkUrl({ id: 'student', role: UserRole.Student }, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.evaluationCriteria.findFirst).toHaveBeenCalledWith({
      where: { code: dto.criteriaCode, isActive: true },
      select: { id: true },
    });
    expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
    expect(prisma.evidence.create).not.toHaveBeenCalled();
  });

  it('rejects a stale form before writing evidence', async () => {
    const { service, prisma } = setup();
    prisma.evaluationForm.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.linkUrl({ id: 'student', role: UserRole.Student }, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.evidence.create).not.toHaveBeenCalled();
  });

  it('checks ownership of both the evidence and its parent form when removing', async () => {
    const { service, prisma } = setup();
    await service.remove({ id: 'student', role: UserRole.Student }, 'evidence');
    expect(prisma.evidence.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evidence', studentId: 'student' },
      }),
    );
    expect(prisma.evaluationForm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: dto.evaluationFormId, studentId: 'student' },
      }),
    );
    expect(prisma.evidence.delete).toHaveBeenCalledTimes(1);
  });

  it('does not remove evidence when its parent form is locked', async () => {
    const { service, prisma } = setup({ isLocked: true });
    await expect(
      service.remove({ id: 'student', role: UserRole.Student }, 'evidence'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.evidence.delete).not.toHaveBeenCalled();
  });
});
