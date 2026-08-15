type ConfigValue = string | number | boolean | null | undefined;

type ConfigReader = {
  get<T = ConfigValue>(key: string): T | undefined;
};

type ConfigSource = Record<string, unknown> | ConfigReader;

function readConfigValue(source: ConfigSource, key: string): string | undefined {
  const value =
    typeof (source as ConfigReader).get === 'function'
      ? (source as ConfigReader).get<ConfigValue>(key)
      : (source as Record<string, unknown>)[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function encodeDatabasePart(value: string): string {
  return encodeURIComponent(value);
}

export function resolveDatabaseUrl(
  source: ConfigSource,
  preferredKey: 'DATABASE_URL' | 'DIRECT_URL' = 'DATABASE_URL',
): string | undefined {
  const preferredUrl = readConfigValue(source, preferredKey);
  if (preferredUrl) {
    return preferredUrl;
  }

  const fallbackUrl = readConfigValue(
    source,
    preferredKey === 'DATABASE_URL' ? 'DIRECT_URL' : 'DATABASE_URL',
  );
  if (fallbackUrl) {
    return fallbackUrl;
  }

  const host = readConfigValue(source, 'DB_HOST');
  const database = readConfigValue(source, 'DB_NAME');
  const password = readConfigValue(source, 'DB_PASS');

  if (!host || !database || password === undefined) {
    return undefined;
  }

  const port = readConfigValue(source, 'DB_PORT') ?? '5432';
  const user = readConfigValue(source, 'DB_USER') ?? 'postgres';
  const schema = readConfigValue(source, 'DB_SCHEMA') ?? 'public';

  return [
    'postgresql://',
    encodeDatabasePart(user),
    ':',
    encodeDatabasePart(password),
    '@',
    host,
    ':',
    port,
    '/',
    encodeDatabasePart(database),
    '?schema=',
    encodeDatabasePart(schema),
  ].join('');
}
