export const cacheKeys = {
  studentImport: (id: string) => `import:students:${id}`,
  classImport: (id: string) => `import:classes:${id}`,
};
export const cacheTtl = {
  importPreview: 600,
} as const;
