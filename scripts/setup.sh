#!/usr/bin/env bash
#
# One-shot setup for the whole stack.
#
#   npm run setup
#
# Idempotent: safe to run again after `npm run db:reset`, and safe to run when
# everything is already in place. Each step explains what it is doing, because
# the point of this repo is to be read rather than just executed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
bold "1/6  Postgres"
docker compose -f infra/docker-compose.yml up -d --wait
info "Databases:"
docker exec apm-postgres psql -U postgres -lqt | cut -d'|' -f1 | grep -E 'payload_crud|medusa_crud' | sed 's/^/     /'

# ─────────────────────────────────────────────────────────────────────────────
bold "2/6  Dependencies"
for app in cms commerce storefront; do
  if [ -d "apps/$app/node_modules" ]; then
    info "apps/$app — already installed"
  else
    info "apps/$app — installing"
    npm --prefix "apps/$app" install
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
bold "3/6  Payload CMS"
info "Payload pushes its schema automatically in dev, so there is no migrate step."
info "Seeding content and generating an API key…"
CMS_OUT="$(npm --prefix apps/cms run --silent seed 2>&1)"
echo "$CMS_OUT" | grep -E 'Created|Reusing|already exists' | sed 's/^/     /' || true
PAYLOAD_API_KEY="$(echo "$CMS_OUT" | grep -oE 'PAYLOAD_API_KEY=[^ ]+' | head -1 | cut -d= -f2)"
info "API key: ${PAYLOAD_API_KEY:-<not captured>}"

# ─────────────────────────────────────────────────────────────────────────────
bold "4/6  Medusa migrations"
info "Medusa is explicit: every schema change needs a generated migration."
npm --prefix apps/commerce run --silent db:migrate 2>&1 | grep -E 'Migrat|links|completed' | sed 's/^/     /' || true

# ─────────────────────────────────────────────────────────────────────────────
bold "5/6  Medusa data"
info "Base commerce data (products, regions, sales channel)…"
npm --prefix apps/commerce run --silent seed > /dev/null 2>&1 || info "(already seeded)"

info "Admin user…"
npm --prefix apps/commerce run --silent user -- \
  -e "${MEDUSA_ADMIN_EMAIL:-admin@local.test}" \
  -p "${MEDUSA_ADMIN_PASSWORD:-supersecret}" 2>&1 | grep -iE 'created|already' | sed 's/^/     /' || true

info "Reviews, created through the workflow so the link rows exist…"
npm --prefix apps/commerce run --silent seed:reviews 2>&1 | grep -E 'Seeded|already' | sed 's/^/     /' || true

info "Publishable API key…"
MEDUSA_OUT="$(npm --prefix apps/commerce run --silent bootstrap 2>&1)"
MEDUSA_PUBLISHABLE_KEY="$(echo "$MEDUSA_OUT" | grep -oE 'MEDUSA_PUBLISHABLE_KEY=[^ ]+' | head -1 | cut -d= -f2)"
info "Publishable key: ${MEDUSA_PUBLISHABLE_KEY:-<not captured>}"

# ─────────────────────────────────────────────────────────────────────────────
bold "6/6  Storefront environment"
ENV_FILE="apps/storefront/.env"

if [ ! -f "$ENV_FILE" ]; then
  cp apps/storefront/.env.example "$ENV_FILE"
  info "Created $ENV_FILE from the example."
fi

if [ -n "${PAYLOAD_API_KEY:-}" ]; then
  sed -i "s|^PAYLOAD_API_KEY=.*|PAYLOAD_API_KEY=$PAYLOAD_API_KEY|" "$ENV_FILE"
  info "Wrote PAYLOAD_API_KEY"
fi

if [ -n "${MEDUSA_PUBLISHABLE_KEY:-}" ]; then
  sed -i "s|^MEDUSA_PUBLISHABLE_KEY=.*|MEDUSA_PUBLISHABLE_KEY=$MEDUSA_PUBLISHABLE_KEY|" "$ENV_FILE"
  info "Wrote MEDUSA_PUBLISHABLE_KEY"
fi

# ─────────────────────────────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────────────────
  Ready. Start all three services:

    npm run dev

    Storefront     http://localhost:4321
    CMS admin      http://localhost:3000/admin   admin@local.test / supersecret
    Medusa admin   http://localhost:9000/app     admin@local.test / supersecret

  Read the architecture walkthrough in README.md, then try the requests in
  docs/requests.http.
────────────────────────────────────────────────────────────────────────────

EOF
