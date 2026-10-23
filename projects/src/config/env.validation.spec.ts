import { validateEnvironment } from './env.validation';
import { resolveDatabaseUrl } from './database-url.helper';

const base = {
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  DB_HOST: 'localhost',
  DB_NAME: 'test',
  DB_PASS: ' password@:#/ ',
};

describe('environment configuration', () => {
  it('supplies defaults without changing passwords or the input', () => {
    const result = validateEnvironment(base);
    expect(result).toMatchObject({
      BACKEND_PORT: '5050',
      LOG_LEVEL: 'info',
      PRISMA_CONNECT_ON_INIT: 'true',
      DB_POOL_MAX: '10',
      DB_POOL_IDLE_TIMEOUT: '30000',
      DB_POOL_CONNECTION_TIMEOUT: '2000',
      DB_PASS: base.DB_PASS,
    });
    expect(base).not.toHaveProperty('BACKEND_PORT');
    expect(
      decodeURIComponent(new URL(resolveDatabaseUrl(result)!).password),
    ).toBe(base.DB_PASS);
  });

  it('keeps runtime and migration URL precedence explicit', () => {
    const env = {
      ...base,
      DATABASE_URL: 'postgresql://app:pass@pool/test',
      DIRECT_URL: 'postgresql://app:pass@direct/test',
    };
    expect(resolveDatabaseUrl(env)).toBe(env.DATABASE_URL);
    expect(resolveDatabaseUrl(env, 'DIRECT_URL')).toBe(env.DIRECT_URL);
  });

  it.each([
    ['BACKEND_PORT', '0'],
    ['BACKEND_PORT', '65536'],
    ['DB_PORT', 'not-a-port'],
    ['DB_POOL_MAX', '0'],
    ['DB_POOL_MAX', '1001'],
    ['DB_POOL_MAX', '1.5'],
    ['DB_POOL_IDLE_TIMEOUT', '0'],
    ['DB_POOL_IDLE_TIMEOUT', '600001'],
    ['DB_POOL_CONNECTION_TIMEOUT', '0'],
    ['DB_POOL_CONNECTION_TIMEOUT', '60001'],
    ['SMTP_PORT', '1.5'],
    ['PRISMA_CONNECT_ON_INIT', 'yes'],
    ['SWAGGER_ENABLED', '0'],
    ['SMTP_SECURE', 'TRUE'],
    ['LOG_LEVEL', 'trace'],
    ['METRICS_ENABLED', 'yes'],
    ['REPORT_RETENTION_SECONDS', '-1'],
    ['OTEL_ENABLED', '1'],
    ['METRICS_TOKEN', 'short'],
    ['OTEL_TRACES_SAMPLER_ARG', '1.1'],
    ['OTEL_TRACES_SAMPLER_ARG', 'NaN'],
    ['DB_SLOW_QUERY_MS', '-1'],
    ['OTEL_SERVICE_NAME', 'invalid/service'],
    [
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      'https://user:secret@example.com/v1/traces',
    ],
    ['NODE_ENV', 'prod'],
    ['JWT_ACCESS_EXPIRES_IN', '3600'],
    ['FRONTEND_URL', 'javascript:alert(1)'],
    ['FRONTEND_URL', 'https://example.com/login'],
    ['PASSWORD_RESET_URL', 'invalid'],
  ])('rejects invalid %s without including its value', (key, value) => {
    expect(() => validateEnvironment({ ...base, [key]: value })).toThrow(key);
  });

  it('allows false flags, multiple origins and disabled mail', () => {
    expect(
      validateEnvironment({
        ...base,
        SWAGGER_ENABLED: 'false',
        PRISMA_CONNECT_ON_INIT: 'false',
        FRONTEND_URL: 'http://localhost:3000,https://example.com',
        SMTP_HOST: '',
        SMTP_FROM: '',
      }),
    ).toMatchObject({
      SWAGGER_ENABLED: 'false',
      PRISMA_CONNECT_ON_INIT: 'false',
    });
  });

  it('requires a dedicated metrics token in production unless metrics are disabled', () => {
    expect(() =>
      validateEnvironment({ ...base, NODE_ENV: 'production' }),
    ).toThrow('METRICS_TOKEN');
    expect(
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        METRICS_ENABLED: 'false',
      }),
    ).toMatchObject({ METRICS_ENABLED: 'false' });
    expect(
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        METRICS_TOKEN: 'test-metrics-token-with-at-least-32-chars',
      }),
    ).toMatchObject({ METRICS_ENABLED: 'true' });
  });

  it('rejects incomplete SMTP configuration', () => {
    expect(() =>
      validateEnvironment({ ...base, SMTP_HOST: 'smtp.example.com' }),
    ).toThrow('SMTP_HOST and SMTP_FROM');
  });

  it('does not reveal credentials in database validation errors', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        DATABASE_URL: 'https://user:private-password@example.com/test',
      }),
    ).toThrow('Database connection must be a valid PostgreSQL URL');
  });

  it('rejects missing database credentials and identical JWT secrets', () => {
    expect(() =>
      validateEnvironment({ JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'b' }),
    ).toThrow('Missing database config');
    expect(() =>
      validateEnvironment({
        ...base,
        JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET,
      }),
    ).toThrow('must be different');
  });
});
