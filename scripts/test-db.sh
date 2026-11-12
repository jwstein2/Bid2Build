#!/usr/bin/env bash
# Start a throwaway local Postgres for database tests (plain Postgres + Supabase stubs).
# Usage: scripts/test-db.sh start|stop   -> exports nothing; tests use TEST_DATABASE_URL or the default below.
set -euo pipefail
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DATA=${PGDATA_TEST:-/tmp/b2b-pgdata}
PORT=${PGPORT_TEST:-54329}
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(sudo -u "${PG_RUN_USER:-claude}"); fi
case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      mkdir -p "$DATA"; [ ${#RUN_AS[@]} -gt 0 ] && chown "${PG_RUN_USER:-claude}" "$DATA"
      "${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
    fi
    "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c max_connections=50" -l "$DATA/log" -w start >/dev/null || true
    echo "postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -w stop >/dev/null || true
    ;;
esac
