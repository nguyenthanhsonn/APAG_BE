import { resolveDatabaseUrl } from './database-url.helper';

type Environment = Record<string, unknown>;

export function validateEnvironment(config: Environment): Environment {
  config = { ...config };
  const defaults = {
    NODE_ENV: 'development',
    BACKEND_HOST: '0.0.0.0',
    BACKEND_PORT: '5050',
    DB_PORT: '5432',
    DB_USER: 'postgres',
    DB_SCHEMA: 'public',
    DB_POOL_MAX: '10',
    DB_POOL_IDLE_TIMEOUT: '30000',
    DB_POOL_CONNECTION_TIMEOUT: '2000',
    PRISMA_CONNECT_ON_INIT: 'true',
    SWAGGER_ENABLED: 'true',
    LOG_LEVEL: 'info',
    METRICS_ENABLED: 'true',
    REPORT_RETENTION_SECONDS: '86400',
    OTEL_ENABLED: 'false',
    OTEL_SERVICE_NAME: 'apag-backend',
    OTEL_TRACES_SAMPLER_ARG: '0.1',
    DB_SLOW_QUERY_MS: '500',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_STARTTLS: 'true',
    SMTP_FROM_NAME: 'CSMTS',
    SMTP_CLIENT_NAME: 'localhost',
  };
  for (const [key, fallback] of Object.entries(defaults)) {
    config[key] = String(config[key] ?? '').trim() || fallback;
  }
  const required = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !String(config[key] ?? '').trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    throw new Error(
      'Missing database config: set DATABASE_URL or DB_HOST, DB_NAME, DB_PASS',
    );
  }

  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    );
  }

  for (const key of [
    'BACKEND_PORT',
    'DB_PORT',
    'DB_PUBLISHED_PORT',
    'SMTP_PORT',
  ]) {
    if (config[key] === undefined || config[key] === '') continue;
    const port = Number(config[key]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${key} must be an integer between 1 and 65535`);
    }
  }
  for (const key of [
    'PRISMA_CONNECT_ON_INIT',
    'METRICS_ENABLED',
    'OTEL_ENABLED',
    'SWAGGER_ENABLED',
    'SMTP_SECURE',
    'SMTP_STARTTLS',
  ]) {
    if (!['true', 'false'].includes(String(config[key])))
      throw new Error(`${key} must be true or false`);
  }
  if (
    !['development', 'test', 'production'].includes(String(config.NODE_ENV))
  ) {
    throw new Error('NODE_ENV must be development, test or production');
  }
  if (
    !['error', 'warn', 'info', 'debug', 'verbose'].includes(
      String(config.LOG_LEVEL),
    )
  ) {
    throw new Error('LOG_LEVEL must be error, warn, info, debug or verbose');
  }
  for (const key of ['JWT_ACCESS_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN']) {
    if (!/^[1-9]\d*(ms|s|m|h|d|w|y)$/.test(String(config[key]))) {
      throw new Error(
        `${key} must be a positive duration with a unit, e.g. 15m or 7d`,
      );
    }
  }
  for (const key of [
    'FRONTEND_URL',
    'STUDENT_PORTAL_URL',
    'PASSWORD_RESET_URL',
  ]) {
    const value = String(config[key] ?? '').trim();
    if (!value) continue;
    for (const entry of key === 'FRONTEND_URL' ? value.split(',') : [value]) {
      try {
        const url = new URL(entry.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        if (
          key === 'FRONTEND_URL' &&
          (url.pathname !== '/' ||
            url.search ||
            url.hash ||
            url.username ||
            url.password)
        ) {
          throw new Error();
        }
      } catch {
        throw new Error(`${key} must contain valid HTTP(S) URLs`);
      }
    }
  }
  for (const [key, min, max] of [
    ['DB_POOL_MAX', 1, 1000],
    ['DB_POOL_IDLE_TIMEOUT', 1, 600000],
    ['DB_POOL_CONNECTION_TIMEOUT', 100, 60000],
    ['REPORT_RETENTION_SECONDS', 60, 86400],
  ] as const) {
    const value = Number(config[key]);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} must be ${min}..${max}`);
  }
  const ratio = Number(config.OTEL_TRACES_SAMPLER_ARG);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
    throw new Error('OTEL_TRACES_SAMPLER_ARG must be between 0 and 1');
  const slowQueryMs = Number(config.DB_SLOW_QUERY_MS);
  if (!Number.isFinite(slowQueryMs) || slowQueryMs < 0)
    throw new Error('DB_SLOW_QUERY_MS must be a non-negative number');
  const metricsToken = String(config.METRICS_TOKEN ?? '');
  if (metricsToken && (metricsToken.length < 32 || /\s/.test(metricsToken)))
    throw new Error(
      'METRICS_TOKEN must have at least 32 non-whitespace characters',
    );
  if (
    config.NODE_ENV === 'production' &&
    config.METRICS_ENABLED === 'true' &&
    !metricsToken
  )
    throw new Error(
      'METRICS_TOKEN is required for production metrics (or set METRICS_ENABLED=false)',
    );
  if (config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    try {
      const endpoint = new URL(
        String(config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
      );
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error();
    } catch {
      throw new Error(
        'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an HTTP(S) URL without credentials/query',
      );
    }
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(String(config.OTEL_SERVICE_NAME)))
    throw new Error('OTEL_SERVICE_NAME must be a bounded service identifier');
  if (Boolean(config.SMTP_HOST) !== Boolean(config.SMTP_FROM)) {
    throw new Error('SMTP_HOST and SMTP_FROM must be configured together');
  }

  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
      throw new Error();
  } catch {
    throw new Error('Database connection must be a valid PostgreSQL URL');
  }

  return config;
}
