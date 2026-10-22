import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

@Injectable()
export class QueueCrypto {
  private readonly key: Buffer;
  constructor(config: ConfigService) {
    this.key = createHash('sha256')
      .update('apag-queue-v1:')
      .update(
        config.get<string>('QUEUE_ENCRYPTION_KEY') ||
          config.getOrThrow<string>('app.jwtRefreshSecret'),
      )
      .digest();
  }
  digest(value: string) {
    return createHmac('sha256', this.key).update(value).digest('hex');
  }
  seal(value: unknown, aad: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      'base64',
    );
  }
  open<T>(encrypted: string, aad: string): T {
    const raw = Buffer.from(encrypted, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      raw.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(raw.subarray(28)),
        decipher.final(),
      ]).toString(),
    ) as T;
  }
}

// JSON object key order is not part of an idempotent business intent.
export function canonicalPayload(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    return item;
  };
  return JSON.stringify(normalize(value));
}
