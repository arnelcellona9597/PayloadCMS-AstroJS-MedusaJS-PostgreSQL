#!/usr/bin/env bash
#
# Export both databases plus the uploaded media files.
#
#   npm run db:export
#
# Writes backups/<timestamp>/ containing one dump per database, a tar of the
# media directory, and a manifest describing exactly what was captured.
#
# ── Why pg_dump runs INSIDE the container ────────────────────────────────────
#
# The container has Postgres 17.11; this machine's client is 17.7. pg_dump
# refuses to dump a server newer than itself — it cannot know about syntax added
# after it was built, so it fails rather than write a dump that will not restore:
#
#   pg_dump: error: server version: 17.11; pg_dump version: 17.7
#   pg_dump: error: aborting because of server version mismatch
#
# Running the container's own pg_dump sidesteps version skew permanently: the
# client and server are the same build by construction. The binary output is
# streamed to stdout and captured here, so nothing has to be written inside the
# container and then copied out.
#
# Note `docker exec` is used WITHOUT -t. A TTY would translate newlines in the
# binary stream and produce a corrupt dump that only fails at restore time.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="${PG_CONTAINER:-apm-postgres}"
PGUSER="${PGUSER:-postgres}"
DATABASES=(payload_crud medusa_crud)
MEDIA_DIR="apps/cms/public/media"

bold() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '   \033[33m! %s\033[0m\n' "$1"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Postgres container '$CONTAINER' is not running. Start it with: npm run db:up" >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DEST="backups/$STAMP"
mkdir -p "$DEST"

bold "Exporting to $DEST"

# ─────────────────────────────────────────────────────────────────────────────
# Dumps
#
# -Fc is the custom format, not plain SQL. It is compressed, and it lets
# pg_restore be selective later (`-t one_table`, `--data-only`, reordering for
# dependencies). A plain .sql file can only ever be replayed start to finish.
# ─────────────────────────────────────────────────────────────────────────────
for db in "${DATABASES[@]}"; do
  docker exec "$CONTAINER" pg_dump -U "$PGUSER" -Fc --no-owner --no-privileges -d "$db" > "$DEST/$db.dump"
  info "$(printf '%-14s %s' "$db" "$(du -h "$DEST/$db.dump" | cut -f1)")"
done

# ─────────────────────────────────────────────────────────────────────────────
# Media
#
# Payload stores upload METADATA in Postgres and the FILES on disk. A
# database-only backup therefore restores rows pointing at files that are no
# longer there — every image 404s and the CMS looks corrupted.
#
# This is the local-disk storage decision coming due; see
# docs/learn/09-to-production.md §9.7 on why production uses object storage,
# where backup is the storage provider's problem rather than this script's.
# ─────────────────────────────────────────────────────────────────────────────
if [ -d "$MEDIA_DIR" ] && [ -n "$(ls -A "$MEDIA_DIR" 2>/dev/null)" ]; then
  tar -czf "$DEST/media.tar.gz" -C "$(dirname "$MEDIA_DIR")" "$(basename "$MEDIA_DIR")"
  MEDIA_FILES=$(find "$MEDIA_DIR" -type f | wc -l | tr -d ' ')
  info "$(printf '%-14s %s (%s files)' "media" "$(du -h "$DEST/media.tar.gz" | cut -f1)" "$MEDIA_FILES")"
else
  MEDIA_FILES=0
  warn "no media files to archive"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Manifest
#
# The part that makes the dumps trustworthy rather than merely present.
#
# A dump is a snapshot of data in a schema shape. Restore it into code that has
# since migrated and you get a database that is neither the old state nor the
# new one. So the migration bookkeeping is recorded here, and db-import.sh
# compares it against the live database before touching anything.
#
# Row counts serve the other half: after a restore you can prove the data came
# back, rather than assuming it did because no command printed an error.
# ─────────────────────────────────────────────────────────────────────────────
row_counts() {
  # One query for exact counts of every table. The xpath/query_to_xml trick runs
  # a real count(*) per table without a shell loop — reltuples from pg_class
  # would be faster but it is an ESTIMATE, and "roughly the same number of rows
  # came back" is not a verification.
  docker exec "$CONTAINER" psql -U "$PGUSER" -d "$1" -t -A -F$'\t' -c "
    select table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int as n
    from (
      select table_name,
             query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name),
                          false, true, '') as xml_count
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    ) t
    where (xpath('/row/cnt/text()', xml_count))[1]::text::int > 0
    order by table_name;
  "
}

migration_state() {
  case "$1" in
    payload_crud)
      # Payload in dev mode uses `push`, not migration files, so this table
      # holds a single bookkeeping row ('dev', batch -1) rather than a list of
      # applied migrations. Recorded anyway: if it ever holds real rows, this
      # project switched to migrations and the count starts meaning something.
      docker exec "$CONTAINER" psql -U "$PGUSER" -d "$1" -t -A -c \
        "select coalesce(string_agg(name || ':' || batch, ',' order by id), 'none') from payload_migrations;"
      ;;
    medusa_crud)
      # Three independent ledgers, and they must be compared together — module
      # schemas, cross-module links, and data scripts each migrate separately.
      docker exec "$CONTAINER" psql -U "$PGUSER" -d "$1" -t -A -c \
        "select concat('mikro_orm:', (select count(*) from mikro_orm_migrations),
                       ' links:',    (select count(*) from link_module_migrations),
                       ' scripts:',  (select count(*) from script_migrations));"
      ;;
  esac
}

SERVER_VERSION="$(docker exec "$CONTAINER" psql -U "$PGUSER" -t -A -c 'show server_version;')"
DUMP_VERSION="$(docker exec "$CONTAINER" pg_dump --version | awk '{print $NF}')"

{
  printf '{\n'
  printf '  "createdAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "serverVersion": "%s",\n' "$SERVER_VERSION"
  printf '  "pgDumpVersion": "%s",\n' "$DUMP_VERSION"
  printf '  "mediaFiles": %s,\n' "$MEDIA_FILES"
  printf '  "databases": {\n'

  first_db=1
  for db in "${DATABASES[@]}"; do
    [ $first_db -eq 1 ] || printf ',\n'
    first_db=0
    printf '    "%s": {\n' "$db"
    # sha256 so db-import.sh can detect a dump truncated by a full disk or an
    # interrupted export. A dump that restores halfway is the worst outcome.
    printf '      "sha256": "%s",\n' "$(sha256sum "$DEST/$db.dump" | cut -d' ' -f1)"
    printf '      "bytes": %s,\n' "$(stat -c%s "$DEST/$db.dump")"
    printf '      "migrationState": "%s",\n' "$(migration_state "$db" | xargs)"
    printf '      "rowCounts": {\n'
    first_row=1
    while IFS=$'\t' read -r table n; do
      [ -z "$table" ] && continue
      [ $first_row -eq 1 ] || printf ',\n'
      first_row=0
      printf '        "%s": %s' "$(echo "$table" | xargs)" "$(echo "$n" | xargs)"
    done < <(row_counts "$db")
    printf '\n      }\n    }'
  done

  printf '\n  }\n}\n'
} > "$DEST/manifest.json"

python3 -m json.tool "$DEST/manifest.json" > /dev/null || {
  echo "Manifest is not valid JSON — refusing to leave a misleading backup." >&2
  exit 1
}

bold "Done"
python3 - "$DEST/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for db, d in m["databases"].items():
    counts = d["rowCounts"]
    print(f'   {db:14} {len(counts)} non-empty tables, {sum(counts.values())} rows')
    print(f'   {"":14} migrations: {d["migrationState"]}')
PY
info ""
info "Restore with:  npm run db:import -- $DEST"
