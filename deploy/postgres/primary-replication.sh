#!/bin/sh
# Runs once when the primary's data directory is first created: lets streaming
# replicas connect with password authentication. For an existing database,
# see docs/scalability.md ("Add a read replica").
set -eu
echo "host replication all all scram-sha-256" >> "$PGDATA/pg_hba.conf"
