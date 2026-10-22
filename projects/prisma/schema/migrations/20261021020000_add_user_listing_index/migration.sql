-- Measured on synthetic benchmark data; see docs/database-performance.md.
-- Keep one concurrent statement in this migration. Do not wrap in BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY "users_created_at_id_idx"
ON "users" ("created_at" DESC, "id" DESC);
