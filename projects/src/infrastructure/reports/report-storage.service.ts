import { GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReportFormat } from './report.types';

@Injectable()
export class ReportStorage {
  readonly root: string;
  readonly lifetime: number;
  constructor(config: ConfigService) {
    this.root = resolve(
      config.get<string>('REPORT_EXPORT_DIR') || '.local/report-exports',
    );
    this.lifetime = Number(config.get('REPORT_RETENTION_SECONDS') || 86400);
  }
  private path(id: string, format: ReportFormat) {
    if (
      !/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(id) ||
      !['pdf', 'xlsx', 'docx'].includes(format)
    )
      throw new Error('Invalid report object key');
    return join(this.root, `${id}.${format}`);
  }
  async save(id: string, format: ReportFormat, data: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(id, format),
      temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return { bytes: data.length, expiresAt: Date.now() + this.lifetime * 1000 };
  }
  async read(id: string, format: ReportFormat, expiresAt: number) {
    if (Date.now() >= expiresAt)
      throw new GoneException('File export đã hết hạn');
    try {
      return await readFile(this.path(id, format));
    } catch {
      throw new GoneException(
        'File export không còn khả dụng, vui lòng tạo lại',
      );
    }
  }
  async cleanup() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.root)) {
      if (
        !/^(?:[a-f0-9]{64}|[a-f0-9-]{36})\.(?:pdf|xlsx|docx)(?:\.[a-f0-9-]{36}\.tmp)?$/.test(
          name,
        )
      )
        continue;
      const file = join(this.root, name);
      const info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs > this.lifetime * 1000)
        await unlink(file).catch(() => undefined);
    }
  }
}
