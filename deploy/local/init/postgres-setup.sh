#!/bin/sh
# Creates the runtime role the API and the worker sign in as, with the generated password, and
# resets that password on every start. The migration then grants it table access only.
set -eu
PGPASSWORD="$(cat /postgres-secrets/postgres_password)"
export PGPASSWORD
psql --host=postgres --username=postgres --dbname="${DRAFT_LOOP_DATABASE_NAME:-draft_loop}" \
  --set=ON_ERROR_STOP=1 --set=password="$(cat /secrets/app_password)" <<'SQL'
SELECT 'CREATE ROLE draft_loop_app LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'draft_loop_app') \gexec
ALTER ROLE draft_loop_app LOGIN PASSWORD :'password';
SQL
