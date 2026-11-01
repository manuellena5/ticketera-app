#!/usr/bin/env bash
# Levanta un Postgres local descartable, aplica la emulación de Supabase,
# las migraciones, la semilla y corre los tests SQL.
#   tests/sql/correr.sh            → corre todos los tests/sql/[1-9]*.sql
#   tests/sql/correr.sh 10_fase0   → corre solo ese
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"
PUERTO="${PUERTO:-54329}"
COMO=""
if [ "$(id -u)" = "0" ]; then
  chown postgres "$DIR"
  COMO="runuser -u postgres --"
fi

limpiar() { $COMO "$PGBIN/pg_ctl" -D "$DIR/datos" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap limpiar EXIT

$COMO "$PGBIN/initdb" -D "$DIR/datos" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
$COMO "$PGBIN/pg_ctl" -D "$DIR/datos" -o "-k $DIR -p $PUERTO -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PUERTO" -U postgres -d postgres)

echo "· Emulación de Supabase"
"${PSQL[@]}" -f "$RAIZ/tests/sql/00_supabase_stub.sql" >/dev/null
for m in "$RAIZ"/supabase/migrations/*.sql; do
  echo "· Migración $(basename "$m")"
  "${PSQL[@]}" -f "$m" >/dev/null
done
echo "· Semilla"
"${PSQL[@]}" -f "$RAIZ/supabase/seed.sql" >/dev/null

if [ $# -gt 0 ]; then
  TESTS=("$RAIZ/tests/sql/$1.sql")
else
  TESTS=("$RAIZ"/tests/sql/[1-9]*.sql)
fi

for t in "${TESTS[@]}"; do
  echo
  echo "=== $(basename "$t")"
  # Cada archivo de test corre en una transacción que se descarta,
  # así los tests no se pisan entre sí.
  if ! { echo 'begin;'; cat "$t"; echo; echo 'rollback;'; } | "${PSQL[@]}" -o /dev/null 2>&1 \
       | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /' -e 's/^psql:[^ ]* ERROR:  /  ERROR: /'; then
    echo; echo "Tests con fallas."; exit 1
  fi
done
