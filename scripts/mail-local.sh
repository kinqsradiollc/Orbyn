#!/usr/bin/env bash
# Local Maddy -> authenticated STARTTLS -> Mailpit, with all delivery captured locally.
set -euo pipefail
cd "$(dirname "$0")/.."
compose() { docker compose -f mail/compose.local.yaml "$@"; }
case "${1:-up}" in
  up)
    mkdir -p mail/.local
    if [ ! -s mail/.local/cert.pem ] || [ ! -s mail/.local/key.pem ]; then
      openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
        -keyout mail/.local/key.pem -out mail/.local/cert.pem \
        -subj /CN=inbox -addext subjectAltName=DNS:inbox \
        -addext basicConstraints=critical,CA:TRUE 2>/dev/null
      chmod 600 mail/.local/key.pem
    fi
    compose up -d --wait --wait-timeout 90
    echo "SMTP: 127.0.0.1:11587 (sender: reminders@orbyn.test; no client auth)"
    echo "Test inbox: http://127.0.0.1:18025"
    ;;
  test) python3 scripts/test-mail-local.py ;;
  down) compose down ;;
  logs) compose logs --tail 100 mail ;;
  *) echo "Usage: $0 [up|test|down|logs]" >&2; exit 2 ;;
esac
