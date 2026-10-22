// Logical keys. RedisService adds REDIS_KEY_PREFIX to isolate environments/tests.
export const cacheKeys = {
  revokedToken: (jti: string) => `auth:revoked:${jti}`,
  userRevokedAfter: (userId: string) => `auth:user-revoked-after:${userId}`,
  profile: (userId: string) => `profile:${userId}`,
  studentImport: (id: string) => `import:students:${id}`,
  classImport: (id: string) => `import:classes:${id}`,
};
export const cacheTtl = {
  profile: 30,
  importPreview: 600,
} as const;
