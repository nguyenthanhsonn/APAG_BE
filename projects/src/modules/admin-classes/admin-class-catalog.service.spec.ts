import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AdminClassCatalogService } from './admin-class-catalog.service';

describe('class leader assignment uniqueness', () => {
  function setup() {
    const repository = {
      findActiveById: jest.fn().mockResolvedValue({ id: 'class' }),
      findAssignableClassLeaderUsers: jest
        .fn()
        .mockResolvedValue([{ id: 'leader' }]),
      findClassLeadersAssignedElsewhere: jest.fn().mockResolvedValue([]),
      replaceClassLeaders: jest.fn(),
    };
    return {
      repository,
      service: new AdminClassCatalogService(
        repository as never,
        {} as never,
        {} as never,
      ),
    };
  }
  it('refuses an already assigned leader before deleting existing class assignments', async () => {
    const { service, repository } = setup();
    repository.findClassLeadersAssignedElsewhere.mockResolvedValue([
      { userId: 'leader' },
    ]);
    await expect(
      service.updateClassLeaders('class', { userIds: ['leader'] }),
    ).rejects.toThrow('Lớp trưởng đã được phân công');
    expect(repository.replaceClassLeaders).not.toHaveBeenCalled();
  });
  it('returns a specific 409 when another request assigns the leader after the precheck', async () => {
    const { service, repository } = setup();
    repository.replaceClassLeaders.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: {
          modelName: 'ClassLeaderAssignment',
          driverAdapterError: {
            cause: {
              constraint: { index: 'class_leader_assignments_user_id_key' },
            },
          },
        },
      }),
    );
    await expect(
      service.updateClassLeaders('class', { userIds: ['leader'] }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateClassLeaders('class', { userIds: ['leader'] }),
    ).rejects.toThrow('Lớp trưởng');
  });
});
