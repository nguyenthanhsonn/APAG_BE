import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { RedisService } from './redis.service';
import { cacheTtl } from './cache.keys';

@Injectable()
export class ImportPreviewStore {
  private readonly encryptionKey: Buffer;
  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.encryptionKey = createHash('sha256')
      .update('apag-import-preview-v1:')
      .update(config.getOrThrow<string>('app.jwtRefreshSecret'))
      .digest();
  }
  async set(key: string, value: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(this.redis.key(key)));
    const payload = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    await this.redis.set(
      key,
      Buffer.concat([iv, cipher.getAuthTag(), payload]).toString('base64'),
      cacheTtl.importPreview,
    );
  }
  async get<T>(key: string, consume = false): Promise<T | null> {
    const raw = consume
      ? await this.redis.getDel(key)
      : await this.redis.get(key);
    if (!raw) return null;
    const data = Buffer.from(raw, 'base64'),
      decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        data.subarray(0, 12),
      );
    decipher.setAAD(Buffer.from(this.redis.key(key)));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString(),
    ) as T;
  }
  async del(key: string) {
    await this.redis.del(key);
  }
}
