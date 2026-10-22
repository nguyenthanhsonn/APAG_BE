import { canonicalPayload } from '../../infrastructure/queue/queue-crypto.service';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../../infrastructure/queue/queue.service';
import type { EmailPayload } from '../../infrastructure/queue/queue.types';

type Payload<K extends EmailPayload['kind']> = Omit<
  Extract<EmailPayload, { kind: K }>,
  'kind'
>;

// API facade only enqueues AFTER the caller has committed its DB changes; no SMTP in HTTP.
@Injectable()
export class StudentAccountMailService {
  constructor(
    private readonly queues: QueueService,
    private readonly config: ConfigService,
  ) {}
  isConfigured() {
    return !!(
      this.config.get<string>('app.smtp.host') &&
      this.config.get<string>('app.smtp.from')
    );
  }
  async sendStudentAccount(payload: Payload<'student'>) {
    return this.enqueue({ kind: 'student', ...payload });
  }
  async sendStaffAccount(payload: Payload<'staff'>) {
    return this.enqueue({ kind: 'staff', ...payload });
  }
  async sendPasswordReset(payload: Payload<'password-reset'>) {
    return this.enqueue({ kind: 'password-reset', ...payload });
  }
  private enqueue(payload: EmailPayload) {
    if (!this.isConfigured()) throw new Error('Chưa cấu hình SMTP');
    const key = this.queues.crypto.digest(canonicalPayload(payload));
    return this.queues.enqueue('email', payload, {
      key,
      ttl:
        payload.kind === 'password-reset'
          ? payload.expiresAt
            ? (payload.expiresAt - Date.now()) / 1000
            : payload.expiresInMinutes * 60
          : 86400,
    });
  }
}
