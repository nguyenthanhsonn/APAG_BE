-- Measured on synthetic benchmark data; see docs/database-performance.md.
-- Keep one concurrent statement in this migration. Do not wrap in BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY "evaluation_forms_semester_listing_idx"
ON "evaluation_forms" ("semester_id", "submitted_at" DESC, "created_at" DESC);
