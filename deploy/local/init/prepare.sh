#!/bin/sh
# Runs as root before every start of the self-hosted stack (deploy/local/compose.yaml). It creates
# the stack's own random secrets once, copies the operator's provider keys into a volume only the
# API and the worker read, and hands the file volume to the services' user. It prints no secret.
set -eu

# The images' `node` user runs the API, the worker and the migration; `postgres` runs Postgres.
app_uid=1000
postgres_uid=999

# Writes 32 random bytes as hex into a file once, then keeps it: `secret <directory> <name>`.
secret() {
  file="$1/$2"
  if [ ! -s "$file" ]; then
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$file.partial"
    mv "$file.partial" "$file"
    echo "created $2"
  fi
}

secret /secrets owner_token
secret /secrets app_password
chown "$app_uid:$app_uid" /secrets/owner_token /secrets/app_password
chmod 0400 /secrets/owner_token /secrets/app_password
# Its own volume, which the API and the worker never mount: Postgres reads it at first start, and
# the migration signs in with it as the schema owner.
secret /postgres-secrets postgres_password
chown "$postgres_uid:$app_uid" /postgres-secrets/postgres_password
chmod 0440 /postgres-secrets/postgres_password

# The keys are copied on every start, so adding, replacing or removing a file in keys/ takes effect
# at the next `up`. Only `<provider>_api_key` files are copied.
find /provider-keys -mindepth 1 -maxdepth 1 -name '*_api_key' -exec rm -f {} +
for key in /keys/*_api_key; do
  [ -f "$key" ] || continue
  name="$(basename "$key")"
  cp "$key" "/provider-keys/$name"
  chown "$app_uid:$app_uid" "/provider-keys/$name"
  chmod 0400 "/provider-keys/$name"
  echo "copied $name"
done

chown "$app_uid:$app_uid" /blobs
chmod 0700 /blobs
