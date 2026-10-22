/** Không xuất thông báo lỗi driver/SMTP: có thể chứa SQL, token hoặc AUTH challenge. */
export function safeError(error: unknown) {
  if (!(error instanceof Error)) return { type: 'UnknownError' };
  const code = (error as Error & { code?: unknown }).code;
  return {
    type: /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(error.name)
      ? error.name
      : 'Error',
    ...(typeof code === 'string' &&
    /^(?:P\d{4}|\d{5}|E[A-Z_]{2,40})$/.test(code)
      ? { code }
      : {}),
  };
}
const sensitiveKey =
  /password|passphrase|secret|token|authorization|cookie|credential|smtp.*pass|db.*pass|api.?key|^pass$|^body$|^headers$|^params$|^query$|^sql$|statement|connectionstring|database.?url|redis.?url|direct.?url|reseturl/i;
export function sanitizeLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[Truncated]';
  if (value instanceof Error) return safeError(value);
  if (typeof value === 'string') {
    let result = value
      .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[REDACTED]')
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        '[REDACTED]',
      )
      .replace(
        /\b(?:postgres(?:ql)?|rediss?|https?):\/\/[^\s]+/gi,
        '[URL REDACTED]',
      )
      .replace(
        /((?:password|secret|token|SMTP_PASS|DB_PASS)\s*[=:]\s*)[^\s,;]+/gi,
        '$1[REDACTED]',
      );
    // Defense in depth for legacy free-text Nest logs. Do not print env values while constructing this list.
    for (const [key, secret] of Object.entries(process.env)) {
      if (sensitiveKey.test(key) && secret && secret.length >= 3)
        result = result.split(secret).join('[REDACTED]');
    }
    return result.slice(0, 2000);
  }
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitizeLog(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '__proto__')
        .map(([key, item]) => [
          key,
          sensitiveKey.test(key) ? '[REDACTED]' : sanitizeLog(item, depth + 1),
        ]),
    );
  return value;
}
