/**
 * Run work concurrently and let each piece fail on its own.
 *
 * Extracted from pages/index.astro once a second page needed it. Two pages
 * sharing one copy is the point: the dashboard and /monitor must degrade the
 * same way, and two copies of a failure-handling helper drift until they do not.
 *
 * ── Why not Promise.allSettled ────────────────────────────────────────────
 *
 * `allSettled` gives you the outcome but not the duration, and on this dashboard
 * the duration is half the signal — "Medusa answered, in 4 seconds" is a
 * different operational fact from "Medusa answered". It also hands back a
 * `reason` of type `any`, which pushes the error-narrowing into every call site.
 *
 * So each unit of work is wrapped individually and the caller still uses
 * `Promise.all`: every call starts at once, and none of them can reject.
 */

export type Timed<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; error: string; ms: number }

export async function settle<T>(work: () => Promise<T>): Promise<Timed<T>> {
  const started = Date.now()
  try {
    return { ok: true, value: await work(), ms: Date.now() - started }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      ms: Date.now() - started,
    }
  }
}
