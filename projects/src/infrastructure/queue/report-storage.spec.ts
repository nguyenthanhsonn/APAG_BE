import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReportStorage } from './report-storage.service';

describe('private expiring report output', () => {
  let directory: string;
  let storage: ReportStorage;
  const id = randomUUID();
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'apag-report-storage-'));
    storage = new ReportStorage(
      new ConfigService({
        REPORT_EXPORT_DIR: directory,
        REPORT_RETENTION_SECONDS: 60,
      }),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('writes atomically, keeps files private, and returns bytes only before expiry', async () => {
    const value = Buffer.from('%PDF synthetic'),
      result = await storage.save(id, 'pdf', value);
    expect(await storage.read(id, 'pdf', result.expiresAt)).toEqual(value);
    expect((await stat(join(directory, `${id}.pdf`))).mode & 0o777).toBe(0o600);
    await expect(storage.read(id, 'pdf', Date.now() - 1)).rejects.toMatchObject(
      { status: 410 },
    );
  });
  it('rejects a path outside the output directory', async () => {
    await expect(
      storage.save('../outside', 'pdf', Buffer.from('x')),
    ).rejects.toThrow('Invalid report object key');
  });
  it('removes only expired managed files', async () => {
    await storage.save(id, 'xlsx', Buffer.from('test'));
    const file = join(directory, `${id}.xlsx`),
      old = new Date(Date.now() - 61000);
    await utimes(file, old, old);
    await storage.cleanup();
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
