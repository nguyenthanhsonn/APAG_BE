import { ReportJobsService } from './report-jobs.service';
import {
  ConflictException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

describe('single-instance report export contract', () => {
  function setup() {
    const reports = { getExportRows: jest.fn().mockResolvedValue([]) };
    const renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('report')),
    };
    const storage = {
      lifetime: 60,
      cleanup: jest.fn().mockResolvedValue(undefined),
      save: jest
        .fn()
        .mockImplementation(async () => ({
          bytes: 6,
          expiresAt: Date.now() + 60000,
        })),
      read: jest.fn().mockResolvedValue(Buffer.from('report')),
    };
    const service = new ReportJobsService(
      reports as never,
      renderer as never,
      storage as never,
    );
    return { service, renderer, storage };
  }
  afterEach(() => jest.useRealTimers());
  it('renders once for duplicate requests, keeps owner isolation and detects changed intent', async () => {
    const { service, renderer } = setup();
    const [one, two] = await Promise.all([
      service.create('owner', { format: 'xlsx' }, 'same-key-123'),
      service.create('owner', { format: 'xlsx' }, 'same-key-123'),
    ]);
    expect(one).toEqual(two);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(await service.status('owner', one.jobId)).toMatchObject({
      status: 'completed',
      bytes: 6,
    });
    await expect(
      service.create('owner', { format: 'pdf' }, 'same-key-123'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.download('other', one.jobId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await service.download('owner', one.jobId)).contentType).toContain(
      'spreadsheetml',
    );
  });
  it('bounds concurrent export rendering', async () => {
    const { service, renderer } = setup();
    let finish!: () => void;
    renderer.render.mockImplementation(
      () =>
        new Promise<Buffer>((resolve) => {
          finish = () => resolve(Buffer.from('report'));
        }),
    );
    const creating = service.create('owner', { format: 'pdf' }, 'pending-123');
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      service.create('other', { format: 'pdf' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    finish();
    await creating;
  });
  it('expires file access and returns safe failure status', async () => {
    jest.useFakeTimers();
    const { service, renderer } = setup();
    renderer.render.mockRejectedValueOnce(new Error('private SQL/password'));
    const failed = await service.create('owner', { format: 'pdf' });
    const status = await service.status('owner', failed.jobId);
    expect(status.status).toBe('failed');
    expect(JSON.stringify(status)).not.toContain('private');
    await expect(
      service.download('owner', failed.jobId),
    ).rejects.toBeInstanceOf(ConflictException);
    jest.advanceTimersByTime(60001);
    await expect(service.status('owner', failed.jobId)).rejects.toBeInstanceOf(
      GoneException,
    );
  });
});
