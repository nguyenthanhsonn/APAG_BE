import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

type StudentAccountMailPayload = {
  email: string;
  fullName: string;
  username: string;
  password: string;
  studentCode: string;
};

type StaffAccountMailPayload = {
  email: string;
  fullName: string;
  username: string;
  password: string;
  roleLabel: string;
};

type PasswordResetMailPayload = {
  email: string;
  fullName: string;
  resetUrl: string;
  expiresInMinutes: number;
};

type MailMessage = {
  messageId?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  user?: string;
  pass?: string;
  from: string;
  fromName: string;
  portalUrl: string;
};

@Injectable()
export class SmtpMailService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    const config = this.configService.getOrThrow<SmtpConfig>('app.smtp');
    return Boolean(config.host && config.from);
  }

  async sendStudentAccount(
    payload: StudentAccountMailPayload,
    deliveryId?: string,
  ): Promise<void> {
    const config = this.getConfig();
    const subject = 'Thông tin tài khoản sinh viên';

    await this.sendMail(config, {
      to: payload.email,
      messageId: deliveryId ? `<${deliveryId}@apag.local>` : undefined,
      subject,
      text: buildAccountText(payload, config.portalUrl),
      html: buildAccountHtml(payload, config.portalUrl),
    });
  }

  async sendStaffAccount(
    payload: StaffAccountMailPayload,
    deliveryId?: string,
  ): Promise<void> {
    const config = this.getConfig();
    const subject = 'Thông tin tài khoản hệ thống CSMTS';

    await this.sendMail(config, {
      to: payload.email,
      messageId: deliveryId ? `<${deliveryId}@apag.local>` : undefined,
      subject,
      text: buildStaffAccountText(payload, config.portalUrl),
      html: buildStaffAccountHtml(payload, config.portalUrl),
    });
  }

  async sendPasswordReset(
    payload: PasswordResetMailPayload,
    deliveryId?: string,
  ): Promise<void> {
    const config = this.getConfig();
    const subject = 'Yêu cầu đặt lại mật khẩu CSMTS';

    await this.sendMail(config, {
      to: payload.email,
      messageId: deliveryId ? `<${deliveryId}@apag.local>` : undefined,
      subject,
      text: buildPasswordResetText(payload),
      html: buildPasswordResetHtml(payload),
    });
  }

  private getConfig(): SmtpConfig {
    const config = this.configService.getOrThrow<SmtpConfig>('app.smtp');
    const { host, from } = config;

    if (!host || !from) {
      throw new Error('Chưa cấu hình SMTP_HOST hoặc SMTP_FROM');
    }

    return config;
  }

  private async sendMail(config: SmtpConfig, message: MailMessage) {
    return trace.getTracer('apag.smtp').startActiveSpan(
      'smtp.send',
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'dependency.system': 'smtp',
          'server.address': config.host,
          'server.port': config.port,
        },
      },
      async (span) => {
        try {
          return await this.deliverMail(config, message);
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private async deliverMail(config: SmtpConfig, message: MailMessage) {
    const transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure && config.startTls,
      ignoreTLS: !config.secure && !config.startTls,
      name: this.configService.getOrThrow<string>('app.smtp.clientName'),
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      logger: false,
      debug: false,
    });
    try {
      await transport.sendMail({
        from: { name: config.fromName, address: config.from },
        ...message,
      });
    } finally {
      transport.close();
    }
  }
}

const DEFAULT_LOGIN_URL = 'http://localhost:3000/login';

function getLoginUrl(portalUrl?: string): string {
  if (!portalUrl) return DEFAULT_LOGIN_URL;
  const trimmed = portalUrl.trim();
  if (trimmed.endsWith('/login')) return trimmed;
  return `${trimmed.replace(/\/+$/, '')}/login`;
}

function buildAccountText(
  payload: StudentAccountMailPayload,
  portalUrl: string,
) {
  const loginUrl = getLoginUrl(portalUrl);
  return [
    `Xin chào ${payload.fullName},`,
    '',
    'Thông tin tài khoản sinh viên của bạn:',
    `- Mã sinh viên: ${payload.studentCode}`,
    `- Tên đăng nhập: ${payload.username}`,
    `- Mật khẩu: ${payload.password}`,
    `- Địa chỉ đăng nhập: ${loginUrl}`,
    '',
    'Lưu ý:',
    '- Không chia sẻ tài khoản này cho bất kỳ ai.',
    '- Sau khi đăng nhập thành công, bạn nên đổi mật khẩu ngay.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAccountHtml(
  payload: StudentAccountMailPayload,
  portalUrl: string,
) {
  const loginUrl = getLoginUrl(portalUrl);
  const loginLine = `<li style="margin: 6px 0;">Địa chỉ đăng nhập: <a href="${escapeHtml(
    loginUrl,
  )}" style="color: #b9101a; font-weight: 700; text-decoration: underline;">${escapeHtml(
    loginUrl,
  )}</a></li>`;

  return `
    <div style="margin: 0; padding: 0; background: #ffffff; font-family: Arial, Helvetica, sans-serif; color: #252525;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 760px; margin: 0 auto; border: 18px solid #b9101a; border-collapse: collapse; background: #ffffff;">
        <tr>
          <td style="padding: 0;">
            <div style="height: 118px; background: #ffffff; position: relative; overflow: hidden;">
              <div style="height: 86px; border-bottom: 10px solid #b9101a; transform: skewY(-4deg); transform-origin: left bottom; box-shadow: 0 4px 8px rgba(0,0,0,0.2);"></div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background: #eef3f1; padding: 28px 34px 34px 34px; font-size: 16px; line-height: 1.65;">
            <p style="margin: 0 0 12px 0;">Chào bạn <strong>${escapeHtml(
              payload.fullName,
            )}</strong>,</p>

            <p style="margin: 0 0 14px 0; color: #b9101a; font-size: 20px; line-height: 1.45; font-weight: 700;">
              CHÚC MỪNG bạn đã được tạo tài khoản sinh viên trên hệ thống quản lý sinh viên và đánh giá rèn luyện.
            </p>

            <p style="margin: 0 0 26px 0;">
              Thông tin tài khoản của bạn được gửi bên dưới, vui lòng truy cập
              <a href="${escapeHtml(
                loginUrl,
              )}" style="background: #ffe69a; color: #b9101a; padding: 2px 6px; font-weight: 700; text-decoration: underline;">Trang đăng nhập hệ thống</a>
              để thực hiện đánh giá.
            </p>

            <p style="margin: 0 0 10px 0; font-size: 17px;"><strong>Thông tin sinh viên của bạn:</strong></p>
            <ul style="margin: 0 0 28px 28px; padding: 0;">
              <li style="margin: 6px 0;">Mã sinh viên: ${escapeHtml(
                payload.studentCode,
              )}</li>
              <li style="margin: 6px 0;">Họ và tên: ${escapeHtml(
                payload.fullName,
              )}</li>
            </ul>

            <p style="margin: 0 0 10px 0; font-size: 17px;"><strong>Thông tin tài khoản của bạn:</strong></p>
            <ul style="margin: 0 0 18px 28px; padding: 0;">
              <li style="margin: 6px 0;">Tên đăng nhập: <strong>${escapeHtml(
                payload.username,
              )}</strong></li>
              <li style="margin: 6px 0;">Mật khẩu: <strong>${escapeHtml(
                payload.password,
              )}</strong></li>
              ${loginLine}
            </ul>

            <p style="margin: 20px 0 10px 0; font-size: 16px;"><strong>Lưu ý:</strong></p>
            <ul style="margin: 0 0 0 28px; padding: 0;">
              <li style="margin: 6px 0;">Không chia sẻ tài khoản này cho bất kỳ ai.</li>
              <li style="margin: 6px 0;">Sau khi đăng nhập thành công, bạn nên đổi mật khẩu ngay.</li>
              <li style="margin: 6px 0;">Nếu quên mật khẩu, vui lòng liên hệ quản trị viên để được hỗ trợ.</li>
            </ul>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildStaffAccountText(
  payload: StaffAccountMailPayload,
  portalUrl: string,
) {
  const loginUrl = getLoginUrl(portalUrl);
  return [
    `Xin chào ${payload.fullName},`,
    '',
    'Thông tin tài khoản hệ thống CSMTS của bạn:',
    `- Vai trò: ${payload.roleLabel}`,
    `- Tên đăng nhập: ${payload.username}`,
    `- Mật khẩu: ${payload.password}`,
    `- Địa chỉ đăng nhập: ${loginUrl}`,
    '',
    'Lưu ý:',
    '- Không chia sẻ tài khoản này cho bất kỳ ai.',
    '- Sau khi đăng nhập thành công, bạn nên đổi mật khẩu ngay.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildStaffAccountHtml(
  payload: StaffAccountMailPayload,
  portalUrl: string,
) {
  const loginUrl = getLoginUrl(portalUrl);
  const loginLine = `<li style="margin: 6px 0;">Địa chỉ đăng nhập: <a href="${escapeHtml(
    loginUrl,
  )}" style="color: #b9101a; font-weight: 700; text-decoration: underline;">${escapeHtml(
    loginUrl,
  )}</a></li>`;

  return `
    <div style="margin: 0; padding: 0; background: #ffffff; font-family: Arial, Helvetica, sans-serif; color: #252525;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 760px; margin: 0 auto; border: 18px solid #b9101a; border-collapse: collapse; background: #ffffff;">
        <tr>
          <td style="padding: 0;">
            <div style="height: 118px; background: #ffffff; position: relative; overflow: hidden;">
              <div style="height: 86px; border-bottom: 10px solid #b9101a; transform: skewY(-4deg); transform-origin: left bottom; box-shadow: 0 4px 8px rgba(0,0,0,0.2);"></div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background: #eef3f1; padding: 28px 34px 34px 34px; font-size: 16px; line-height: 1.65;">
            <p style="margin: 0 0 12px 0;">Chào <strong>${escapeHtml(
              payload.fullName,
            )}</strong>,</p>

            <p style="margin: 0 0 14px 0; color: #b9101a; font-size: 20px; line-height: 1.45; font-weight: 700;">
              THÔNG TIN TÀI KHOẢN HỆ THỐNG CSMTS (${escapeHtml(
                payload.roleLabel,
              ).toUpperCase()})
            </p>

            <p style="margin: 0 0 26px 0;">
              Tài khoản làm việc của bạn đã được khởi tạo. Vui lòng truy cập
              <a href="${escapeHtml(
                loginUrl,
              )}" style="background: #ffe69a; color: #b9101a; padding: 2px 6px; font-weight: 700; text-decoration: underline;">Trang đăng nhập hệ thống</a>
              để bắt đầu làm việc.
            </p>

            <p style="margin: 0 0 10px 0; font-size: 17px;"><strong>Thông tin tài khoản của bạn:</strong></p>
            <ul style="margin: 0 0 18px 28px; padding: 0;">
              <li style="margin: 6px 0;">Vai trò: <strong>${escapeHtml(
                payload.roleLabel,
              )}</strong></li>
              <li style="margin: 6px 0;">Tên đăng nhập: <strong>${escapeHtml(
                payload.username,
              )}</strong></li>
              <li style="margin: 6px 0;">Mật khẩu: <strong>${escapeHtml(
                payload.password,
              )}</strong></li>
              ${loginLine}
            </ul>

            <p style="margin: 20px 0 10px 0; font-size: 16px;"><strong>Lưu ý:</strong></p>
            <ul style="margin: 0 0 0 28px; padding: 0;">
              <li style="margin: 6px 0;">Không chia sẻ tài khoản này cho bất kỳ ai.</li>
              <li style="margin: 6px 0;">Sau khi đăng nhập thành công, bạn nên đổi mật khẩu ngay.</li>
              <li style="margin: 6px 0;">Nếu gặp sự cố, vui lòng liên hệ quản trị viên để được hỗ trợ.</li>
            </ul>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildPasswordResetText(payload: PasswordResetMailPayload) {
  return [
    `Xin chào ${payload.fullName},`,
    '',
    'Hệ thống nhận được yêu cầu đặt lại mật khẩu cho tài khoản CSMTS của bạn.',
    payload.resetUrl
      ? `Vui lòng mở đường dẫn sau để tạo mật khẩu mới: ${payload.resetUrl}`
      : 'Không tạo được đường dẫn đặt lại mật khẩu. Vui lòng liên hệ quản trị viên.',
    `Đường dẫn này chỉ có hiệu lực trong ${payload.expiresInMinutes} phút và chỉ sử dụng được một lần.`,
    '',
    'Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPasswordResetHtml(payload: PasswordResetMailPayload) {
  const resetAction = payload.resetUrl
    ? `<p style="margin: 22px 0;"><a href="${escapeHtml(
        payload.resetUrl,
      )}" style="display: inline-block; background: #b9101a; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 16px;">Tạo mật khẩu mới</a></p>
         <p style="margin: 0 0 18px 0; color: #4b5563; word-break: break-all;">Hoặc copy đường dẫn: <a href="${escapeHtml(
           payload.resetUrl,
         )}" style="color: #b9101a; font-weight: 700;">${escapeHtml(
           payload.resetUrl,
         )}</a></p>`
    : '<p style="margin: 22px 0; color: #b9101a; font-weight: 700;">Không tạo được đường dẫn đặt lại mật khẩu. Vui lòng liên hệ quản trị viên.</p>';

  return `
    <div style="margin: 0; padding: 0; background: #ffffff; font-family: Arial, Helvetica, sans-serif; color: #252525;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 760px; margin: 0 auto; border: 18px solid #b9101a; border-collapse: collapse; background: #ffffff;">
        <tr>
          <td style="padding: 0;">
            <div style="height: 118px; background: #ffffff; position: relative; overflow: hidden;">
              <div style="height: 86px; border-bottom: 10px solid #b9101a; transform: skewY(-4deg); transform-origin: left bottom; box-shadow: 0 4px 8px rgba(0,0,0,0.2);"></div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background: #eef3f1; padding: 28px 34px 34px 34px; font-size: 16px; line-height: 1.65;">
            <p style="margin: 0 0 12px 0;">Xin chào <strong>${escapeHtml(
              payload.fullName,
            )}</strong>,</p>
            <p style="margin: 0 0 14px 0; font-size: 20px; line-height: 1.45; font-weight: 700; color: #b9101a;">
              Yêu cầu đặt lại mật khẩu tài khoản CSMTS
            </p>
            <p style="margin: 0 0 12px 0;">
              Hệ thống nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng nhấn vào nút bên dưới để tạo mật khẩu mới.
            </p>
            ${resetAction}
            <p style="margin: 0 0 12px 0;">
              Đường dẫn này chỉ có hiệu lực trong <strong>${
                payload.expiresInMinutes
              } phút</strong> và chỉ sử dụng được một lần.
            </p>
            <p style="margin: 0; color: #6b7280;">
              Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.
            </p>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
