import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Reads the three services' dev logs off disk and normalises them.
 *
 * ── Why this reads files, and why that is dev-only ────────────────────────
 *
 * All three services log to disk locally: Payload and Medusa because
 * `npm run dev` pipes their stdout through `tee`, Astro because it writes its
 * own log (see SOURCES). So the output you watch scroll past can be read back
 * after it has gone.
 *
 * This works **only because all three services share a filesystem**, which is
 * true in development and false in essentially every deployment. In production
 * you do not tail files across services — each emits structured logs and
 * something else aggregates them (docs/learn/09-to-production.md §9.8). This is
 * the local-development version of that, and it does not generalise.
 *
 * ── Two formats, and why the text one is a heuristic ──────────────────────
 *
 * Astro hands over JSON-lines with a real `level` field, so for the storefront
 * this reader just *reads* the level. Payload (pino) and Medusa print
 * human-formatted text, so for those two the level has to be **guessed** from
 * the words in the line — see classify().
 *
 * That guess is wrong sometimes: a line containing the word "error" inside an
 * otherwise informational message gets classified as an error. Compare the two
 * paths below and the argument for structured logging makes itself — one is
 * exact, the other is a regex over prose. The imprecision is left visible here
 * rather than hidden behind a clean-looking API.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export type LogLine = {
  service: string
  level: LogLevel
  text: string
  /** Line number within the file — the only ordering information available. */
  line: number
}

/**
 * Where each service's log actually lives — and they are not uniform.
 *
 * `cms` and `commerce` are plain text, teed from stdout by the dev scripts.
 *
 * `storefront` is different: **Astro 7 backgrounds its own dev server** when
 * stdout is not a TTY, and writes structured JSON-lines to `.astro/dev.log`
 * itself. The tee therefore captures only the launcher's startup message, and
 * the real log is Astro's.
 *
 * That asymmetry is worth keeping rather than papering over: one service hands
 * you structured logs, two hand you text, and the reader has to cope with both.
 * That is precisely the situation that motivates structured logging in the
 * first place (docs/learn/09-to-production.md §9.8).
 */
const SOURCES = {
  cms: { file: 'logs/cms.log', format: 'text' as const },
  commerce: { file: 'logs/commerce.log', format: 'text' as const },
  storefront: { file: 'apps/storefront/.astro/dev.log', format: 'json' as const },
} satisfies Record<string, { file: string; format: 'text' | 'json' }>

const SERVICES = ['cms', 'commerce', 'storefront'] as const

/**
 * Only the tail is read. A long dev session produces a large file, and a log
 * viewer that gets slower the longer the server runs is one you stop opening.
 */
const MAX_BYTES = 256 * 1024

/**
 * Terminal colour codes, which would otherwise render as literal garbage.
 * Built from a char code so this file contains no actual control byte.
 */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')

function classify(text: string): LogLevel {
  const t = text.toLowerCase()

  // Ordered most-severe-first, so a line mentioning both "error" and "warn"
  // classifies as an error.
  if (/\b(fatal|error|err|exception|unhandled|failed)\b/.test(t)) return 'error'
  if (/\b(warn|warning|deprecated)\b/.test(t)) return 'warn'
  if (/\b(debug|trace)\b/.test(t)) return 'debug'
  return 'info'
}

async function readTail(path: string): Promise<string[]> {
  const info = await stat(path)
  const content = await readFile(path, 'utf8')

  if (info.size <= MAX_BYTES) {
    return content.split('\n')
  }

  // Drop the first (partial) line after slicing so nothing renders half-parsed.
  return content.slice(-MAX_BYTES).split('\n').slice(1)
}

export type LogQuery = {
  /** Minimum severity to include. 'warn' returns warnings AND errors. */
  level?: LogLevel | 'all'
  service?: string
  search?: string
  limit?: number
}

const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export async function readLogs(
  /** Repository root. SOURCES paths are relative to it, not to any app dir. */
  repoRoot: string,
  { level = 'all', service, search, limit = 200 }: LogQuery = {},
): Promise<{
  lines: LogLine[]
  counts: Record<LogLevel, number>
  sources: string[]
  missing: string[]
}> {
  const wanted = service ? [service] : [...SERVICES]

  const lines: LogLine[] = []
  const sources: string[] = []
  const missing: string[] = []

  for (const name of wanted) {
    if (!(SERVICES as readonly string[]).includes(name)) continue

    const source = SOURCES[name as keyof typeof SOURCES]

    try {
      const raw = await readTail(join(repoRoot, source.file))
      sources.push(name)

      raw.forEach((text, i) => {
        const clean = text.replace(ANSI, '').trimEnd()
        if (!clean) return

        if (source.format === 'json') {
          /**
           * Astro emits one JSON object per line. Trust its own `level` rather
           * than guessing from the text — that is the entire advantage of
           * structured logs, and ignoring it here would waste it.
           */
          try {
            const parsed = JSON.parse(clean) as { message?: string; level?: string }
            const message = parsed.message ?? clean
            const level = (['error', 'warn', 'info', 'debug'] as const).includes(
              parsed.level as LogLevel,
            )
              ? (parsed.level as LogLevel)
              : classify(message)

            /**
             * Astro logs every request at info level, including 4xx and 5xx.
             * Upgrade those, or a page full of 500s would read as "no errors".
             */
            const upgraded = /\[(4|5)\d\d\]/.test(message)
              ? (/\[5\d\d\]/.test(message) ? 'error' : 'warn')
              : level

            lines.push({ service: name, level: upgraded, text: message, line: i })
            return
          } catch {
            // Not JSON after all — fall through to the text path.
          }
        }

        lines.push({ service: name, level: classify(clean), text: clean, line: i })
      })
    } catch {
      // A missing file is expected: that service may not have started, or was
      // run directly without the tee. Reported rather than thrown, so one
      // missing file does not blank the entire view.
      missing.push(name)
    }
  }

  /**
   * Counts come from everything read, BEFORE filtering, so the level chips can
   * show what switching the filter would give you.
   */
  const counts: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0 }
  for (const l of lines) counts[l.level] += 1

  let filtered = lines

  if (level !== 'all') {
    const min = SEVERITY[level]
    filtered = filtered.filter((l) => SEVERITY[l.level] >= min)
  }

  if (search) {
    const needle = search.toLowerCase()
    filtered = filtered.filter((l) => l.text.toLowerCase().includes(needle))
  }

  return {
    // Newest is last in the file, so take from the end and reverse for display.
    lines: filtered.slice(-Math.min(1000, Math.max(1, limit))).reverse(),
    counts,
    sources,
    missing,
  }
}
