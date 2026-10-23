import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { cacheTtl } from './cache.keys';

@Injectable()
export class ImportPreviewStore {
  private readonly encryptionKey: Buffer;
  private readonly previews = new Map<
    string,
    { encrypted: string; expiresAt: number }
  >();
  constructor(config: ConfigService) {
    this.encryptionKey = createHash('sha256')
      .update('apag-import-preview-v1:')
      .update(config.getOrThrow<string>('app.jwtRefreshSecret'))
      .digest();
  }
  async set(key: string, value: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(key));
    const payload = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    this.prune();
    if (this.previews.size >= 100 && !this.previews.has(key)) {
      throw new ServiceUnavailableException(
        'Quá nhiều import preview, vui lòng thử lại sau',
      );
    }
    this.previews.set(key, {
      encrypted: Buffer.concat([iv, cipher.getAuthTag(), payload]).toString(
        'base64',
      ),
      expiresAt: Date.now() + cacheTtl.importPreview * 1000,
    });
  }
  async get<T>(key: string, consume = false): Promise<T | null> {
    this.prune();
    const preview = this.previews.get(key);
    if (!preview) return null;
    // Claim trước await: hai confirm đồng thời chỉ có một request lấy được preview.
    if (consume) this.previews.delete(key);
    const raw = preview.encrypted;
    const data = Buffer.from(raw, 'base64'),
      decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        data.subarray(0, 12),
      );
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString(),
    ) as T;
  }
  private prune() {
    for (const [key, preview] of this.previews) {
      if (preview.expiresAt <= Date.now()) this.previews.delete(key);
    }
  }
  async del(key: string) {
    this.previews.delete(key);
  }
}
