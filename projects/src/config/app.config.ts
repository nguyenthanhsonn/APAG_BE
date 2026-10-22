import { registerAs } from '@nestjs/config';
import type { LogLevel } from '@nestjs/common';
import { resolveDatabaseUrl } from './database-url.helper';

export default registerAs('app', () => ({
  port: Number(process.env.BACKEND_PORT ?? 5050),
  host: process.env.BACKEND_HOST ?? '0.0.0.0',
  databaseUrl: resolveDatabaseUrl(process.env),
  databasePool: {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT ?? 30000),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT ?? 2000),
  },
  connectOnInit: process.env.PRISMA_CONNECT_ON_INIT !== 'false',
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  logLevels: resolveLogLevels(process.env.LOG_LEVEL ?? 'info'),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  frontendUrls: parseUrlList(
    process.env.FRONTEND_URL ?? 'http://localhost:3000',
  ),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  dummyPasswordHash: process.env.DUMMY_PASSWORD_HASH || undefined,
  passwordResetUrl: process.env.PASSWORD_RESET_URL?.trim() || undefined,
  studentPortalUrl: process.env.STUDENT_PORTAL_URL?.trim() || undefined,
  smtp: {
    host: process.env.SMTP_HOST?.trim() ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    startTls: process.env.SMTP_STARTTLS !== 'false',
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM?.trim() ?? '',
    fromName: process.env.SMTP_FROM_NAME ?? 'CSMTS',
    clientName: process.env.SMTP_CLIENT_NAME ?? 'localhost',
    portalUrl:
      process.env.STUDENT_PORTAL_URL?.trim() ||
      `${parseUrlList(process.env.FRONTEND_URL ?? 'http://localhost:3000')[0]}/login`,
  },
}));

function resolveLogLevels(level: string): LogLevel[] {
  const levels: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const index = ['error', 'warn', 'info', 'debug', 'verbose'].indexOf(level);
  return levels.slice(0, index + 1);
}

function parseUrlList(value: string): string[] {
  return value
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => new URL(url).origin);
}
