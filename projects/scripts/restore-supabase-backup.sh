#!/usr/bin/env bash
set -euo pipefail

RESET_DATABASE="false"

if [ "${1:-}" = "--reset" ]; then
  RESET_DATABASE="true"
  shift
fi

BACKUP_FILE="${1:-supabase_backup.sql}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_NAME="${DB_NAME:-apag}"
DB_USER="${DB_USER:-postgres}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" up -d db

echo "Waiting for Postgres..."
until docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "$DB_USER" -d postgres >/dev/null 2>&1; do
  sleep 1
done

if [ "$RESET_DATABASE" = "true" ]; then
  echo "Resetting database: $DB_NAME"
  docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d postgres \
    -v ON_ERROR_STOP=1 \
    -v dbname="$DB_NAME" \
    -v dbuser="$DB_USER" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'dbname' AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS :"dbname";
CREATE DATABASE :"dbname" OWNER :"dbuser";
SQL
else
  echo "Checking database is empty enough to restore safely..."
  TABLE_COUNT="$(docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")"
  if [ "$TABLE_COUNT" != "0" ]; then
    echo "Database '$DB_NAME' already has $TABLE_COUNT public tables." >&2
    echo "Refusing to restore without reset. Re-run with: $0 --reset $BACKUP_FILE" >&2
    exit 1
  fi
fi

echo "Creating Supabase compatibility roles..."
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 < infra/postgres/init/001-supabase-roles.sql

echo "Restoring backup. Supabase-only extension/schema errors are expected on vanilla Postgres."
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=0 < "$BACKUP_FILE"

echo "Checking restored app tables..."
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT 'users' AS table_name, COUNT(*) FROM public.users UNION ALL SELECT 'classes', COUNT(*) FROM public.classes UNION ALL SELECT 'evaluation_forms', COUNT(*) FROM public.evaluation_forms;"

echo "Done."
