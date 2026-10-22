ALTER TABLE "notifications" ADD COLUMN "dedupe_key" VARCHAR(64);
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
CREATE TABLE "operation_receipts" (
  "scope" VARCHAR(64) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operation_receipts_pkey" PRIMARY KEY ("scope")
);
