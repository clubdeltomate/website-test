#!/usr/bin/env bash
# Spin up a throwaway PostgreSQL 16 cluster, create the schema, run the full
# economic-cycle integration test against it, then tear everything down.
set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PGDATA="$WORK/pgdata"
SOCK="$WORK/sock"
PORT=54329
export PGHOST="$SOCK"

# Postgres refuses to run as root; when we are root, own the server process as
# an unprivileged user. The test client still connects over the trust socket.
PGUSER_RUN="pgrunner"
if [ "$(id -u)" = "0" ]; then
  AS=(runuser -u "$PGUSER_RUN" --)
  chown -R "$PGUSER_RUN" "$WORK"
else
  AS=()
fi

cleanup() {
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "▶ initdb…"
"${AS[@]}" "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null

mkdir -p "$SOCK"
chown -R "$PGUSER_RUN" "$WORK" 2>/dev/null || true
echo "▶ starting postgres on socket $SOCK…"
"${AS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" \
  -o "-p $PORT -k $SOCK -c listen_addresses=''" \
  -w -l "$WORK/pg.log" start >/dev/null

"${AS[@]}" "$PGBIN/createdb" -h "$SOCK" -p "$PORT" -U postgres cycle

export DATABASE_URL="postgresql://postgres@/cycle?host=$SOCK&port=$PORT"
export SKETCHLEARN_ALLOW_MOCK_AI=1
export JWT_SECRET="cycle-test-secret"
export NODE_ENV=test
PSQL=("${AS[@]}" "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d cycle -v ON_ERROR_STOP=1 -q)

echo "▶ creating schema + enum types…"
# drizzle-kit generate emits table SQL that references the pgSchema enums but
# does not create the schema/types itself, so we create them up front.
"${PSQL[@]}" <<'SQL'
CREATE SCHEMA IF NOT EXISTS sketchlearn;
CREATE TYPE "sketchlearn"."role" AS ENUM ('user','moderator','admin');
CREATE TYPE "sketchlearn"."provider" AS ENUM ('openai','anthropic','gemini','elevenlabs');
CREATE TYPE "sketchlearn"."capability" AS ENUM ('text','image','tts');
CREATE TYPE "sketchlearn"."template" AS ENUM ('course','restaurant','service','shop','walkthrough','news','other');
CREATE TYPE "sketchlearn"."level" AS ENUM ('A0','A1','A2','B1','B2','C1','C2');
CREATE TYPE "sketchlearn"."imageStyle" AS ENUM ('sketch','watercolor','flat','photo','none');
CREATE TYPE "sketchlearn"."status" AS ENUM ('pending','credited','rejected');
CREATE TYPE "sketchlearn"."targetType" AS ENUM ('repo','slideTool','user');
SQL

echo "▶ applying migration…"
cd "$ROOT"
# strip drizzle's --> statement-breakpoint markers; psql runs the plain SQL
sed 's/--> statement-breakpoint//' db/migrations/0000_init.sql | "${PSQL[@]}" -f -

echo "▶ running the cycle test…"
npx vitest run api/cycle.integration.test.ts

echo "✔ done"
