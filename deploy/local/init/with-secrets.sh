#!/bin/sh
# Starts one service of the self-hosted stack with only the settings it needs from the generated
# secrets, then replaces itself with the service: `with-secrets.sh <api|worker|migrate> <command>`.
set -eu

read_secret() {
  value="$(cat "$1")"
  [ -n "$value" ] || { echo "The stack secret $1 is missing; run the init service." >&2; exit 1; }
  printf '%s' "$value"
}

database="${DRAFT_LOOP_DATABASE_NAME:-draft_loop}"
role="$1"
shift
case "$role" in
  api)
    DRAFT_LOOP_API_OWNER_TOKEN="$(read_secret /secrets/owner_token)"
    DRAFT_LOOP_DATABASE_URL="postgres://draft_loop_app:$(read_secret /secrets/app_password)@postgres:5432/$database"
    export DRAFT_LOOP_API_OWNER_TOKEN DRAFT_LOOP_DATABASE_URL
    ;;
  worker)
    DRAFT_LOOP_DATABASE_URL="postgres://draft_loop_app:$(read_secret /secrets/app_password)@postgres:5432/$database"
    export DRAFT_LOOP_DATABASE_URL
    ;;
  migrate)
    DRAFT_LOOP_MIGRATION_DATABASE_URL="postgres://postgres:$(read_secret /postgres-secrets/postgres_password)@postgres:5432/$database"
    export DRAFT_LOOP_MIGRATION_DATABASE_URL
    ;;
  *)
    echo "Unknown service $role." >&2
    exit 1
    ;;
esac
exec "$@"
