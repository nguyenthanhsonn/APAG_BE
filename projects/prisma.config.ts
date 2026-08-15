import { config } from "dotenv";
import { fileURLToPath } from "url";
import { defineConfig } from "prisma/config";

config({
  path: fileURLToPath(new URL(".env", import.meta.url)),
});

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function resolveDatabaseUrl(): string | undefined {
  const directUrl = readEnv("DIRECT_URL");
  if (directUrl) {
    return directUrl;
  }

  const databaseUrl = readEnv("DATABASE_URL");
  if (databaseUrl) {
    return databaseUrl;
  }

  const host = readEnv("DB_HOST");
  const database = readEnv("DB_NAME");
  const password = process.env["DB_PASS"];

  if (!host || !database || password === undefined) {
    return undefined;
  }

  const port = readEnv("DB_PORT") ?? "5432";
  const user = readEnv("DB_USER") ?? "postgres";
  const schema = readEnv("DB_SCHEMA") ?? "public";

  return [
    "postgresql://",
    encodeURIComponent(user),
    ":",
    encodeURIComponent(password),
    "@",
    host,
    ":",
    port,
    "/",
    encodeURIComponent(database),
    "?schema=",
    encodeURIComponent(schema),
  ].join("");
}

export default defineConfig({
  schema: "prisma/schema/schema.prisma",
  migrations: {
    path: "prisma/schema/migrations",
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
