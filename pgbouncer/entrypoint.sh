#!/bin/sh
# Writes the credentials file and database routes from the environment at
# start, so no password lives in the image.
#
#   DB_USER, DB_PASSWORD   credentials clients use (and PgBouncer forwards)
#   DB_NAME                database name (default orbyn)
#   PRIMARY_HOST           the primary (default postgres)
#   READ_HOST              optional replica; exposes "<DB_NAME>_read" through PgBouncer
#   SERVER_TLS_SSLMODE     TLS to Postgres: prefer (default), require or verify-full
#                          for managed databases that insist on encryption
set -eu
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
DB_NAME="${DB_NAME:-orbyn}"
PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
READ_HOST="${READ_HOST:-}"
SERVER_TLS_SSLMODE="${SERVER_TLS_SSLMODE:-prefer}"

printf '"%s" "%s"\n' "$DB_USER" "$DB_PASSWORD" > /etc/pgbouncer/userlist.txt
chmod 600 /etc/pgbouncer/userlist.txt

{
  echo "[databases]"
  if [ -n "$READ_HOST" ]; then
    echo "${DB_NAME}_read = host=${READ_HOST} port=5432 dbname=${DB_NAME}"
  fi
  echo "* = host=${PRIMARY_HOST} port=5432"
  echo
  cat /etc/pgbouncer/pgbouncer.base.ini
  echo "server_tls_sslmode = ${SERVER_TLS_SSLMODE}"
} > /etc/pgbouncer/pgbouncer.ini

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
