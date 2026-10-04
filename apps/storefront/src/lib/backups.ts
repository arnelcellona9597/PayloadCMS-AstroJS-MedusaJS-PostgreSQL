import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Lists the backups written by scripts/db-export.sh.
 *
 * ── Read-only, deliberately ───────────────────────────────────────────────
 *
 * There is no "create backup" button and no "restore" button, and their absence
 * is a decision rather than an omission.
 *
 * This storefront has **no authentication** (docs/learn/09-to-production.md
 * §9.5 — anyone who can reach it can already delete any review). Adding an
 * endpoint that runs pg_dump would put a complete copy of both databases one
 * unauthenticated GET away: a data-exfiltration route dressed as a convenience.
 * A restore button would be worse — an unauthenticated endpoint that destroys
 * the current database.
 *
 * So the dangerous half stays in scripts you run deliberately from a shell,
 * where the operating system has already decided you are allowed, and the web
 * app is limited to telling you what exists. The general rule: **the blast
 * radius of a button is the blast radius of whoever can press it.**
 *
 * The listing itself reads the local filesystem, so it works only because the
 * script and this server share a machine in development — the same limitation
 * as lib/log-reader.ts.
 */

export type BackupManifest = {
  createdAt: string
  serverVersion: string
  pgDumpVersion: string
  mediaFiles: number
  databases: Record<
    string,
    { sha256: string; bytes: number; migrationState: string; rowCounts: Record<string, number> }
  >
}

export type Backup = {
  name: string
  createdAt: string
  ageHours: number
  bytes: number
  mediaFiles: number
  totalRows: number
  databases: { name: string; rows: number; tables: number; migrationState: string }[]
  /** True when the manifest is missing or unreadable — present but not trustworthy. */
  incomplete: boolean
}

/** A day. Long enough not to nag, short enough that a week-old backup is loud. */
const STALE_AFTER_HOURS = 24

export async function listBackups(repoRoot: string): Promise<{
  backups: Backup[]
  newest: Backup | null
  stale: boolean
  /** Distinguishes "no backups" from "backups exist and the newest is old". */
  everBackedUp: boolean
}> {
  const dir = join(repoRoot, 'backups')

  let entries: string[]
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse() // newest first — the names are ISO timestamps, so this sorts correctly
  } catch {
    // No backups/ directory at all: nobody has ever run the export.
    return { backups: [], newest: null, stale: true, everBackedUp: false }
  }

  const backups: Backup[] = []

  for (const name of entries) {
    const path = join(dir, name)

    let bytes = 0
    try {
      const files = await readdir(path)
      const sizes = await Promise.all(
        files.map(async (f) => {
          try {
            return (await stat(join(path, f))).size
          } catch {
            return 0
          }
        }),
      )
      bytes = sizes.reduce((a, b) => a + b, 0)
    } catch {
      continue
    }

    let manifest: BackupManifest | null = null
    try {
      manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as BackupManifest
    } catch {
      // Left null rather than skipped. A backup directory with no readable
      // manifest is exactly what you want to SEE, because db-import.sh will
      // refuse to restore it — hiding it would hide that fact until you needed it.
    }

    /**
     * The directory name is the export timestamp, so age does not depend on
     * file mtimes — which `cp -r` or a sync tool would happily rewrite.
     */
    const createdAt = manifest?.createdAt ?? name.replace(/Z$/, 'Z')
    const parsed = Date.parse(createdAt.replace(/T(\d{2})-(\d{2})-(\d{2})Z?$/, 'T$1:$2:$3Z'))
    const ageHours = Number.isNaN(parsed) ? Infinity : (Date.now() - parsed) / 3_600_000

    const databases = Object.entries(manifest?.databases ?? {}).map(([dbName, d]) => ({
      name: dbName,
      rows: Object.values(d.rowCounts).reduce((a, b) => a + b, 0),
      tables: Object.keys(d.rowCounts).length,
      migrationState: d.migrationState,
    }))

    backups.push({
      name,
      createdAt,
      ageHours: Math.round(ageHours * 10) / 10,
      bytes,
      mediaFiles: manifest?.mediaFiles ?? 0,
      totalRows: databases.reduce((a, d) => a + d.rows, 0),
      databases,
      incomplete: manifest === null,
    })
  }

  const newest = backups[0] ?? null

  return {
    backups,
    newest,
    stale: !newest || newest.ageHours > STALE_AFTER_HOURS,
    everBackedUp: backups.length > 0,
  }
}
