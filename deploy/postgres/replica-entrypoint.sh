#!/bin/sh
# Streaming read replica. On first start it clones the primary with
# pg_basebackup (-R writes standby.signal and the connection settings), then
# runs as a hot standby that serves read-only queries.
set -eu
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  until pg_isready -h "$PRIMARY_HOST" -U "$PGUSER" >/dev/null 2>&1; do sleep 1; done
  echo "Cloning the primary at $PRIMARY_HOST..."
  pg_basebackup -h "$PRIMARY_HOST" -U "$PGUSER" -D "$PGDATA" -R -X stream
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
fi
# Drop root: official images ship gosu (newer) or su-exec (older Alpine tags).
if command -v gosu >/dev/null 2>&1; then
  exec gosu postgres postgres -c hot_standby=on
fi
exec su-exec postgres postgres -c hot_standby=on
