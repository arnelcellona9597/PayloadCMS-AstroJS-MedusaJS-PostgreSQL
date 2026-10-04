#!/usr/bin/env bash
#
# Regenerate the Postman environment from the apps' .env files.
#
#   npm run postman:env
#
# Why this exists: `npm run db:reset` regenerates PAYLOAD_API_KEY and
# MEDUSA_PUBLISHABLE_KEY. Without this script every reset silently invalidates
# the environment and every request starts failing with 401/400 — the most
# confusing failure mode in this repo.
#
# Writes postman/local.postman_environment.json, which is gitignored because it
# contains real (dev-only) keys. The committed .example alongside it carries
# placeholders.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC="apps/storefront/.env"
OUT="postman/local.postman_environment.json"

if [ ! -f "$SRC" ]; then
  echo "error: $SRC not found. Run 'npm run setup' first." >&2
  exit 1
fi

read_env() { grep -E "^$1=" "$SRC" | head -1 | cut -d= -f2- || true; }

PAYLOAD_URL="$(read_env PAYLOAD_URL)";                 : "${PAYLOAD_URL:=http://localhost:3000}"
MEDUSA_URL="$(read_env MEDUSA_URL)";                   : "${MEDUSA_URL:=http://localhost:9000}"
PAYLOAD_API_KEY="$(read_env PAYLOAD_API_KEY)"
MEDUSA_PUBLISHABLE_KEY="$(read_env MEDUSA_PUBLISHABLE_KEY)"
ADMIN_EMAIL="$(read_env MEDUSA_ADMIN_EMAIL)";          : "${ADMIN_EMAIL:=admin@local.test}"
ADMIN_PASSWORD="$(read_env MEDUSA_ADMIN_PASSWORD)";    : "${ADMIN_PASSWORD:=supersecret}"

for pair in "PAYLOAD_API_KEY:$PAYLOAD_API_KEY" "MEDUSA_PUBLISHABLE_KEY:$MEDUSA_PUBLISHABLE_KEY"; do
  name="${pair%%:*}"; val="${pair#*:}"
  if [ -z "$val" ] || [ "$val" = "REPLACE_ME" ]; then
    echo "error: $name is missing or unset in $SRC." >&2
    echo "       Run 'npm run setup' to seed the backends and write both keys." >&2
    exit 1
  fi
done

mkdir -p postman

PAYLOAD_URL="$PAYLOAD_URL" MEDUSA_URL="$MEDUSA_URL" \
PAYLOAD_API_KEY="$PAYLOAD_API_KEY" MEDUSA_PUBLISHABLE_KEY="$MEDUSA_PUBLISHABLE_KEY" \
ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" OUT="$OUT" \
python3 - <<'PY'
import json, os

def v(key, value, secret=False, enabled=True):
    return {"key": key, "value": value,
            "type": "secret" if secret else "default",
            "enabled": enabled}

env = {
    "id": "3b7c9d21-5e64-4a08-b1f2-7d9c4e6a8f30",
    "name": "Local (astro-payload-medusa)",
    "values": [
        v("payloadUrl", os.environ["PAYLOAD_URL"]),
        v("medusaUrl",  os.environ["MEDUSA_URL"]),
        v("astroUrl",   "http://localhost:4321"),

        v("payloadApiKey",         os.environ["PAYLOAD_API_KEY"], secret=True),
        v("medusaPublishableKey",  os.environ["MEDUSA_PUBLISHABLE_KEY"], secret=True),

        v("adminEmail",    os.environ["ADMIN_EMAIL"]),
        v("adminPassword", os.environ["ADMIN_PASSWORD"], secret=True),

        # Captured at runtime by the collection's test scripts.
        v("medusaJwt", "", secret=True),
        v("payloadJwt", "", secret=True),
        v("productId", ""),
        v("productHandle", ""),
        v("reviewId", ""),
        v("bffReviewId", ""),
        v("postId", ""),
        v("actionPostId", ""),
        v("anonPostCount", ""),
        v("storeReviewCount", ""),
    ],
    "_postman_variable_scope": "environment",
}

with open(os.environ["OUT"], "w") as f:
    json.dump(env, f, indent=2)
    f.write("\n")
PY

echo "wrote $OUT"
echo "  payloadApiKey        ${PAYLOAD_API_KEY:0:8}…"
echo "  medusaPublishableKey ${MEDUSA_PUBLISHABLE_KEY:0:11}…"
echo
echo "Re-import it in Postman (Import → File) after running this, or edit the two"
echo "values in place under Environments → Local (astro-payload-medusa)."
