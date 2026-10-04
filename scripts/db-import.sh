#!/usr/bin/env bash
#
# Restore both databases (and media) from a backup directory.
#
#   npm run db:import -- backups/2026-09-18T11-25-48Z
#   npm run db:import                 # newest backup, with a confirmation prompt
#
# THIS REPLACES THE CURRENT CONTENTS of payload_crud and medusa_crud. It is the
# destructive half of the pair, so it checks four things before writing anything
# and refuses rather than half-restoring.
#
# ── The four checks, and why each one exists ─────────────────────────────────
#
#   1. Dump integrity — sha256 against the manifest. An export interrupted by a
#      full disk leaves a plausible-looking file that fails midway through the
#      restore, when half the old data is already gone.
#
#   2. Migration drift — the manifest records the migration ledgers at export
#      time. Restoring a dump taken BEFORE a migration gives you old data in a
#      shape the running code no longer expects; neither the old state nor the
#      new one, and the errors surface far from the cause. This is the failure
#      mode that makes naive restores dangerous, so it is a hard stop.
#
#   3. Active connections — Postgres will not drop objects another session holds
#      open, so a restore against a running app fails partway. The script
#      terminates other sessions itself, and says so, rather than telling you to
#      go and stop things.
#
#   4. Version skew — the same reason pg_dump runs in the container (see
#      db-export.sh): pg_restore must not be older than the server.
#
# ── What a restore silently invalidates ─────────────────────────────────────
#
# API keys. Payload's key and Medusa's publishable key live IN these databases,
# so restoring replaces them with the ones from the dump — and every .env and
# Postman environment still holds the old values. Exactly the `db:reset`
# problem, and the script ends by reminding you to regenerate.
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
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  fail "Postgres container '$CONTAINER' is not running. Start it with: npm run db:up"
fi

# ── Pick the backup ──────────────────────────────────────────────────────────
SRC="${1:-}"
if [ -z "$SRC" ]; then
  SRC="$(ls -1d backups/*/ 2>/dev/null | sort | tail -1 || true)"
  [ -z "$SRC" ] && fail "No backups found. Create one with: npm run db:export"
  SRC="${SRC%/}"
  info "No directory given — using the newest: $SRC"
fi

SRC="${SRC%/}"
[ -d "$SRC" ] || fail "Not a directory: $SRC"
[ -f "$SRC/manifest.json" ] || fail "No manifest.json in $SRC — refusing to restore a backup that cannot be verified."

bold "Restoring from $SRC"

python3 - "$SRC/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(f'   taken     {m["createdAt"]}')
print(f'   server    {m["serverVersion"]} (pg_dump {m["pgDumpVersion"]})')
print(f'   media     {m["mediaFiles"]} files')
PY

# ── Check 1: integrity ───────────────────────────────────────────────────────
bold "1/4  Dump integrity"
for db in "${DATABASES[@]}"; do
  [ -f "$SRC/$db.dump" ] || fail "Missing dump: $SRC/$db.dump"

  EXPECTED="$(python3 -c "import json,sys; print(json.load(open('$SRC/manifest.json'))['databases']['$db']['sha256'])")"
  ACTUAL="$(sha256sum "$SRC/$db.dump" | cut -d' ' -f1)"

  if [ "$EXPECTED" != "$ACTUAL" ]; then
    fail "$db.dump does not match its checksum — the file is corrupt or was modified. Refusing to restore it."
  fi
  info "$(printf '%-14s ok  %s…' "$db" "${ACTUAL:0:12}")"
done

# ── Check 2: migration drift ─────────────────────────────────────────────────
bold "2/4  Migration state"

# Returns the empty string when the ledger table does not exist — which is the
# normal state of a database that has just been reset.
#
# The `|| true` is load-bearing. This script runs under `set -euo pipefail`, and
# psql exits 1 on 'relation "payload_migrations" does not exist'. With pipefail
# a pipeline reports the FIRST failure, not the last command's status, so
# silencing stderr is not enough — the substitution would still abort the script
# before it could reach the "fresh database" branch below.
current_migration_state() {
  case "$1" in
    payload_crud)
      docker exec "$CONTAINER" psql -U "$PGUSER" -d "$1" -t -A -c \
        "select coalesce(string_agg(name || ':' || batch, ',' order by id), 'none') from payload_migrations;" 2>/dev/null | xargs || true
      ;;
    medusa_crud)
      docker exec "$CONTAINER" psql -U "$PGUSER" -d "$1" -t -A -c \
        "select concat('mikro_orm:', (select count(*) from mikro_orm_migrations),
                       ' links:',    (select count(*) from link_module_migrations),
                       ' scripts:',  (select count(*) from script_migrations));" 2>/dev/null | xargs || true
      ;;
  esac
}

DRIFT=0
for db in "${DATABASES[@]}"; do
  DUMPED="$(python3 -c "import json; print(json.load(open('$SRC/manifest.json'))['databases']['$db']['migrationState'])")"
  CURRENT="$(current_migration_state "$db")"

  if [ -z "$CURRENT" ]; then
    # An empty database is the normal case right after db:reset — nothing to
    # drift from, so this is fine rather than suspicious.
    info "$(printf '%-14s target is empty (fresh database)' "$db")"
  elif [ "$DUMPED" = "$CURRENT" ]; then
    info "$(printf '%-14s matches (%s)' "$db" "$DUMPED")"
  else
    warn "$(printf '%-14s DRIFT' "$db")"
    warn "    dump:    $DUMPED"
    warn "    current: $CURRENT"
    DRIFT=1
  fi
done

if [ "$DRIFT" = "1" ]; then
  printf '\n\033[33mThis dump was taken against a different schema than the one now applied.\033[0m\n'
  printf 'Restoring it gives you old data in a shape the current code does not expect.\n\n'
  printf 'Safe options, in order of preference:\n'
  printf '  1. Check out the commit the dump was taken from, then restore.\n'
  printf '  2. Restore, then re-run migrations:  npm --prefix apps/commerce run db:migrate\n'
  printf '     (works when migrations only ADD things; a dropped column is not recoverable)\n\n'

  if [ "${FORCE:-0}" != "1" ]; then
    read -r -p "Restore anyway? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || fail "Aborted — nothing was changed."
  else
    warn "FORCE=1 — continuing despite drift"
  fi
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
if [ "${FORCE:-0}" != "1" ] && [ "$DRIFT" != "1" ]; then
  printf '\n'
  read -r -p "Replace the contents of ${DATABASES[*]}? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || fail "Aborted — nothing was changed."
fi

# ── Check 3: connections ─────────────────────────────────────────────────────
bold "3/4  Clearing connections"
for db in "${DATABASES[@]}"; do
  # pg_backend_pid() is excluded so this query does not terminate itself.
  KILLED="$(docker exec "$CONTAINER" psql -U "$PGUSER" -t -A -c \
    "select count(*) from (
       select pg_terminate_backend(pid) from pg_stat_activity
       where datname = '$db' and pid <> pg_backend_pid()
     ) t;")"
  info "$(printf '%-14s %s session(s) terminated' "$db" "$(echo "$KILLED" | xargs)")"
done
warn "The apps will have dropped their pooled connections — restart them after this finishes."

# ── Check 4 + restore ────────────────────────────────────────────────────────
bold "4/4  Restoring"
for db in "${DATABASES[@]}"; do
  # --clean --if-exists drops each object before recreating it, so this is a
  # replace rather than a merge. Without it, restoring over existing data leaves
  # the old rows in place and fails on every duplicate key.
  #
  # `docker exec -i` streams the dump to the container's pg_restore over stdin —
  # same-version client by construction (see the header).
  #
  # Exit status is deliberately tolerated: pg_restore returns non-zero for
  # benign warnings too (dropping an object that was never there). The row
  # counts below are the real verification, so failures are reported with their
  # detail rather than inferred from an exit code.
  set +e
  OUT="$(docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$db" \
          --clean --if-exists --no-owner --no-privileges < "$SRC/$db.dump" 2>&1)"
  set -e

  ERRORS="$(echo "$OUT" | grep -c 'error:' || true)"
  if [ "$ERRORS" -gt 0 ]; then
    warn "$(printf '%-14s %s pg_restore error line(s):' "$db" "$ERRORS")"
    echo "$OUT" | grep 'error:' | head -5 | sed 's/^/       /'
  else
    info "$(printf '%-14s restored cleanly' "$db")"
  fi
done

# ── Media ────────────────────────────────────────────────────────────────────
if [ -f "$SRC/media.tar.gz" ]; then
  mkdir -p "$(dirname "$MEDIA_DIR")"
  tar -xzf "$SRC/media.tar.gz" -C "$(dirname "$MEDIA_DIR")"
  info "$(printf '%-14s %s files extracted' "media" "$(find "$MEDIA_DIR" -type f | wc -l | tr -d ' ')")"
fi

# ── Verify against the manifest ──────────────────────────
#
# A backup nobody has restored is a hypothesis, and a restore nobody has counted
# is a different hypothesis. This is the step that turns both into facts.
# ─────────────────────────────────────────────────────────────────────────────
bold "Verification"

COUNT_SQL="
  select table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int as n
  from (
    select table_name,
           query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name),
                        false, true, '') as xml_count
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  ) t
  where (xpath('/row/cnt/text()', xml_count))[1]::text::int > 0
  order by table_name;"

# The comparison is written to a temp file rather than run as an inline heredoc,
# because the obvious spelling is wrong in a way that looks like it works:
#
#   echo "$counts" | python3 - manifest.json "$db" <<XX   # BROKEN
#
# `python3 -` reads its PROGRAM from stdin, and a heredoc redirection REPLACES
# the pipe. Python gets the program, but sys.stdin is then at EOF — so every
# table reads as zero rows and the script reports a catastrophic restore failure
# that never happened. (This exact bug is why the first run of this script
# claimed 15 tables had been lost when the data was in fact all present.)
#
# Passing the data as a FILE keeps program and data on separate channels.
COMPARE="$(mktemp)"
COUNTS="$(mktemp)"
trap 'rm -f "$COMPARE" "$COUNTS"' EXIT

cat > "$COMPARE" <<'COMPARE_SCRIPT'
import json, sys

manifest, db, counts_file = sys.argv[1], sys.argv[2], sys.argv[3]
expected = json.load(open(manifest))["databases"][db]["rowCounts"]

actual = {}
with open(counts_file) as fh:
    for line in fh:
        if not line.strip():
            continue
        name, n = line.rstrip("\n").split("\t")
        actual[name.strip()] = int(n.strip())

# Compared per table, not as a total: two tables off by +3 and -3 would net to
# zero, and a total-only check would call that a successful restore.
diffs = []
for name in sorted(set(expected) | set(actual)):
    want, got = expected.get(name, 0), actual.get(name, 0)
    if want != got:
        diffs.append((name, want, got))

if diffs:
    print(f'   {db:14} {len(diffs)} table(s) differ from the manifest:')
    for name, want, got in diffs[:8]:
        print(f'   {"":14}   {name}: expected {want}, got {got}')
    if len(diffs) > 8:
        print(f'   {"":14}   ... and {len(diffs) - 8} more')
    sys.exit(1)

print(f'   {db:14} {len(actual)} tables, {sum(actual.values())} rows -- matches the manifest exactly')
COMPARE_SCRIPT

MISMATCH=0
for db in "${DATABASES[@]}"; do
  docker exec "$CONTAINER" psql -U "$PGUSER" -d "$db" -t -A -F$'\t' -c "$COUNT_SQL" > "$COUNTS"
  python3 "$COMPARE" "$SRC/manifest.json" "$db" "$COUNTS" || MISMATCH=1
done

# ── What to do next ──────────────────────────────────────────────────────────
bold "Next"
info "The API keys in your .env files came from the OLD database contents and are"
info "now stale — the restored databases contain the keys from the dump:"
info ""
info "    npm run postman:env       # regenerate Postman's environment"
info ""
info "Then restart the apps, which are holding dead connections:"
info ""
info "    npm run dev"

[ "$MISMATCH" = "1" ] && fail "Restore finished but the row counts do not match the manifest. Investigate before trusting this database."
printf '\n\033[32m✓ Restore verified against the manifest.\033[0m\n'
