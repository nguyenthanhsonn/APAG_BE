import { Injectable } from '@nestjs/common';
import { SmtpMailService } from './smtp-mail.service';

/** SMTP trực tiếp sau DB commit; không còn queue/worker bên ngoài. */
@Injectable()
export class StudentAccountMailService {
  constructor(private readonly smtp: SmtpMailService) {}
  isConfigured() {
    return this.smtp.isConfigured();
  }
  sendStudentAccount(
    payload: Parameters<SmtpMailService['sendStudentAccount']>[0],
  ) {
    return this.smtp.sendStudentAccount(payload);
  }
  sendStaffAccount(
    payload: Parameters<SmtpMailService['sendStaffAccount']>[0],
  ) {
    return this.smtp.sendStaffAccount(payload);
  }
  async sendPasswordReset(
    payload: Parameters<SmtpMailService['sendPasswordReset']>[0] & {
      expiresAt?: number;
    },
  ) {
    if (payload.expiresAt !== undefined && payload.expiresAt <= Date.now())
      throw new Error('Link đặt lại mật khẩu đã hết hạn');
    await this.smtp.sendPasswordReset(payload);
  }
}
