# 13 · Deploying it — one VPS, three services

> Counterpart: [09 · To production](09-to-production.md) lists what this repo
> deliberately lacks. This chapter closes those gaps on a real server.

Chapter 9 is a checklist of everything that is wrong with running this stack as
it ships. This one is the other half: the commands that make it right, on a
machine you rent for the price of a sandwich.

It assumes a fresh Ubuntu 24.04 VPS and a domain you control. Everything here was
sized from **measured** numbers rather than guessed, and the measurements are in
§13.1 so you can argue with them.

---

## 13.1 How much server you actually need

Running this stack and *building* it have very different appetites, and the
second one decides what you buy.

| | Measured peak | Notes |
|---|---|---|
| **Runtime, all three** | **834 MB** | Medusa 414 · Payload/Next 320 · Astro 99 |
| Build — Astro | 724 MB | 1.4 seconds |
| Build — Medusa | 1.61 GB | 21 seconds |
| **Build — Payload/Next** | **2.34 GB** | 15 seconds, and the binding constraint |
| Postgres + Redis, idle | ~56 MB | grows with your data |

Add roughly 300 MB for Ubuntu itself.

> **Buy 4 GB.** Runtime needs about 1.4 GB all-in, so 2 GB *runs* it — but the
> Payload build peaks at 2.34 GB and would be killed. At 4 GB you can build on
> the box, which removes an entire category of deployment complexity.

2 vCPU and 40 GB of NVMe is plenty. At the time of writing that is roughly €5–15
a month depending on provider.

⚠️ **The build figure is why shared hosting fails even when it looks adequate.**
A cPanel plan with a 2 GB cap will run all three services comfortably and then
die on the first `npm run build`. The runtime number is the one hosts advertise;
the build number is the one that decides.

---

## 13.2 The shape you are building

```
                    ┌──────────────── your VPS ────────────────┐
  example.com ──────┤ Caddy :443  ──┬──→ Astro      :4321      │
  cms.example.com ──┤  (TLS, auto)  ├──→ Payload    :3000      │
  api.example.com ──┤               └──→ Medusa     :9000      │
                    │                                           │
                    │ Docker: Postgres :5433  ·  Redis :6379    │
                    └───────────────────────────────────────────┘
```

Three Node processes behind one reverse proxy, and the same two containers you
have been running locally. **`infra/docker-compose.yml` transfers unchanged** —
the databases you developed against are the databases you deploy.

Only Caddy is exposed to the internet. The three services bind to localhost, so
nothing reaches Payload or Medusa except through the proxy.

---

## 13.3 Harden the box first

Do this before anything else is installed. Ten minutes now, and the server stops
being interesting to the people who scan for it.

```bash
# as root, on the fresh VPS
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Then disable password login entirely — key-only:

```bash
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
```

⚠️ **Open a second SSH session and confirm you can still log in before closing
the first.** A typo in `sshd_config` plus a closed session is a support ticket.

Firewall, allowing only SSH and HTTP(S):

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Unattended security updates:

```bash
apt update && apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

**Reach for `fail2ban` as well when** the box is public for more than a few weeks.
**Skip it when** you are key-only and firewalled — it mostly protects password
auth you have already disabled.

---

## 13.4 Install the runtime

Node 22 (the repo requires `>=22.12`), Docker, and Caddy.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # expect v22.x
```

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy   # log out and back in for this to take effect
```

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Caddy rather than nginx for one reason: **it obtains and renews TLS certificates
automatically**, with no certbot and no cron job. For three subdomains that is
most of the work gone.

---

## 13.5 Clone, configure, build

```bash
git clone https://github.com/arnelcellona9597/PayloadCMS-AstroJS-MedusaJS-PostgreSQL.git
cd PayloadCMS-AstroJS-MedusaJS-PostgreSQL
npm run db:up        # the same compose file you use locally
```

### Real secrets

The `.env.example` files carry development placeholders. Replace every one:

```bash
openssl rand -base64 32   # run once per secret, never reuse
```

| Variable | File | What it is |
|---|---|---|
| `PAYLOAD_SECRET` | `apps/cms/.env` | signs Payload sessions |
| `JWT_SECRET` | `apps/commerce/.env` | signs Medusa admin tokens |
| `COOKIE_SECRET` | `apps/commerce/.env` | signs Medusa cookies |
| Postgres password | `infra/docker-compose.yml` + both `DATABASE_URL`s | **not** `postgres` |

Point the CORS variables at your real domains, not `localhost`:

```
STORE_CORS=https://example.com
ADMIN_CORS=https://api.example.com
AUTH_CORS=https://api.example.com
```

⚠️ **`npm run setup` writes development values.** Run it once to create the
schema and seed, then replace the secrets and restart. Do not ship what setup
generated.

### Build

```bash
npm run install:all
npm run build --prefix apps/storefront
npm run build --prefix apps/cms
npm run build --prefix apps/commerce
```

On 4 GB these succeed with room to spare. On 2 GB the Payload build is killed —
that is the 2.34 GB in §13.1.

---

## 13.6 Close the gaps chapter 9 names

This is the part that turns a demo into a deployment. Each one maps to a section
of [09 · To production](09-to-production.md).

### Turn off Payload's `push` — §9.2

In development Payload diffs the config against the database and applies the
difference silently. In production that is a schema change nobody reviewed.

Set `push: false` on the adapter in
[`apps/cms/src/payload.config.ts`](../../apps/cms/src/payload.config.ts), then
generate and commit a baseline migration **before** your first deploy:

```bash
npm --prefix apps/cms exec payload migrate:create
```

⚠️ **Do this on a copy first.** The database already has tables; a first
migration that tries to create them again fails. You want a baseline that
represents the current state and is marked applied.

### Move uploads off local disk — §9.7

`apps/cms/public/media` is on the container's filesystem, so a rebuild loses
every image. The seed writes 96 files there and they are not in git.

Install `@payloadcms/storage-s3` and point it at any S3-compatible bucket —
Hetzner Object Storage, Backblaze B2, Cloudflare R2. Until you do, **take the
media directory seriously in backups**; `npm run db:export` already tars it.

### Give the storefront authentication — §9.5

Right now anyone who can reach the storefront can delete any post or review. It
holds an admin-capable Payload API key and performs no authentication of its own.

Minimum viable fix: put the mutating routes behind Caddy basic auth, so only you
reach them.

```
@admin path /posts/new /posts/*/edit /reviews/*/edit /api/*
basic_auth @admin {
    arnel $2a$14$...   # caddy hash-password
}
```

The real fix is a session layer in `src/middleware.ts`. Do not skip this because
the proxy covers it — the proxy is a lock on the door of a house with no walls.

### Keep Redis — §9.3

Already configured, and on a single box it is tempting to drop. Don't. It is what
makes `workflow_execution` persist, and without it a failed workflow leaves no
record that it ever ran.

---

## 13.7 Run the three services under systemd

Passenger-style idling is what makes shared hosting unsuitable for this stack;
systemd simply keeps processes alive. One unit each.

```ini
# /etc/systemd/system/apm-storefront.service
[Unit]
Description=Astro storefront
After=network.target docker.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/PayloadCMS-AstroJS-MedusaJS-PostgreSQL/apps/storefront
EnvironmentFile=/home/deploy/PayloadCMS-AstroJS-MedusaJS-PostgreSQL/apps/storefront/.env
ExecStart=/usr/bin/node ./dist/server/entry.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Payload is the same shape with `ExecStart=/usr/bin/npm run start` in `apps/cms`.

⚠️ **Medusa starts from its build output, not the source root.** `medusa start`
in `apps/commerce` fails with *"Could not find index.html in the admin build
directory"*. The working directory is `apps/commerce/.medusa/server`, and that
directory needs its own `.env`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now apm-storefront apm-cms apm-commerce
systemctl status apm-commerce --no-pager
```

**Reach for systemd when** the service must survive reboots and crashes — which
is all three here. **Skip it when** you are already running everything in
Compose, in which case `restart: unless-stopped` does the same job.

---

## 13.8 Caddy: TLS and three subdomains

```
example.com {
    reverse_proxy localhost:4321
}

cms.example.com {
    reverse_proxy localhost:3000
}

api.example.com {
    reverse_proxy localhost:9000
}
```

That is the entire configuration. Caddy obtains certificates on first request and
renews them without being asked.

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Point all three subdomains at the VPS address with A records first — Caddy cannot
get a certificate for a name that does not resolve to it.

---

## 13.9 Verify the deployment, not just the processes

"systemd says active" is not the same as "it works". The repo can check itself.

```bash
curl -s https://example.com/api/health | python3 -m json.tool
```

A healthy response reports both backends reachable. It returns **503** if either
is down, so it works as an uptime-monitor target.

Then the full suite, from your laptop against the live host:

```bash
npm run typecheck && npm test
```

And the operational view, which is already built:
[`/monitor`](12-operating-it.md) shows uptime, request classes, workflow states,
log levels and backup age. Put it behind the same basic auth as the admin routes.

⚠️ **The uptime job polls `STOREFRONT_URL`.** It is `http://localhost:4321` in
the example env; set it to your real domain or the monitor reports a service that
is up as down.

---

## 13.10 Backups that have been restored

[`npm run db:export`](12-operating-it.md) already writes both databases, the
media directory and a manifest. On a server, schedule it and get it off the box.

```bash
# crontab -e, as deploy
0 3 * * * cd /home/deploy/PayloadCMS-AstroJS-MedusaJS-PostgreSQL && npm run db:export >> ~/backup.log 2>&1
0 4 * * * rclone sync ~/PayloadCMS-AstroJS-MedusaJS-PostgreSQL/backups remote:apm-backups
```

> A backup on the same disk as the database protects you against `db:reset`, not
> against losing the disk.

**Restore one, now, before you need to.** `npm run db:import` verifies the
checksum and refuses a dump taken against a different schema — but a backup
nobody has restored is a hypothesis.

---

## 13.11 Deploying a change

```bash
ssh deploy@example.com
cd PayloadCMS-AstroJS-MedusaJS-PostgreSQL
git pull origin main
npm run install:all
npm run build --prefix apps/cms        # and the other two if they changed
sudo systemctl restart apm-cms
```

⚠️ **There is downtime.** Three services, restarted in sequence, with no
blue-green and no health-gated rollout. For a learning deployment that is
acceptable and worth being honest about; for anything real you want two instances
behind the proxy and a rolling restart — which Redis already makes possible,
since the event bus and locking are shared.

---

## 13.12 What this still is not

Being clear about the remaining distance:

- **One machine.** It is a single point of failure, and the §9.7 note about
  horizontal scaling still applies to file storage.
- **No CI.** Nothing runs the test suite before a deploy except you.
- **No staging environment.** `development` is a branch, not a server. A second
  cheap VPS running `development` would close that.
- **Rollback is `git checkout` and rebuild**, not a versioned artifact you can
  flip back to.

Each of those is a reasonable next step, and none of them is needed to put this
online.

---

## Check yourself

1. Your VPS has 2 GB. Everything runs fine for a week, then your first deploy
   fails. What happened, and which number in §13.1 predicted it?
2. Why does Caddy need the DNS A record to exist *before* it can serve HTTPS?
3. `medusa start` works locally but fails on the server with a missing
   `index.html`. What is different about the working directory?
4. You move uploads to S3. Which part of `npm run db:export` becomes redundant,
   and which part absolutely does not?
5. The uptime job reports the storefront down, but you can load it in a browser.
   Name the variable.
6. You turn off Payload's `push` and deploy. The first migration fails because
   the tables already exist. What should the first migration have been?
7. Redis is running on the same box as everything else. What does that cost you
   that a managed Redis would not, and is it worth paying here?

---

**Next:** [11-capstone.md](11-capstone.md) — build a feature across all three
services, and now you have somewhere to put it.
