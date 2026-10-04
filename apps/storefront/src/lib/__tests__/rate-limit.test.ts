import { beforeEach, describe, expect, it, vi } from 'vitest'

import { check, headers, reset, snapshot } from '../rate-limit'

/**
 * Tests for the rate limiter.
 *
 * Worth testing because the behaviour is entirely time-dependent, and
 * time-dependent code is where "it looked right" fails. `vi.useFakeTimers` lets
 * a sliding window be tested in milliseconds instead of minutes.
 */
describe('rate limiter', () => {
  const config = { max: 3, windowMs: 1000 }

  beforeEach(() => {
    reset()
    vi.useFakeTimers()
  })

  it('allows requests up to the limit', () => {
    const results = [1, 2, 3].map(() => check('a', config))

    expect(results.every((r) => r.allowed)).toBe(true)
    // Counts down, so a client can pace itself before hitting the wall.
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0])
  })

  it('blocks the request past the limit', () => {
    for (let i = 0; i < 3; i++) check('a', config)

    const blocked = check('a', config)

    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    // Never advertise a 0-second wait — a client would hot-loop on it.
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1)
  })

  it('keys are independent', () => {
    for (let i = 0; i < 3; i++) check('a', config)

    // Exhausting one client must not affect another.
    expect(check('b', config).allowed).toBe(true)
  })

  it('releases as the window slides', () => {
    for (let i = 0; i < 3; i++) check('a', config)
    expect(check('a', config).allowed).toBe(false)

    vi.advanceTimersByTime(1001)

    expect(check('a', config).allowed).toBe(true)
  })

  it('slides, rather than resetting on a fixed boundary', () => {
    // Two hits at t=0, one at t=600.
    check('a', config)
    check('a', config)
    vi.advanceTimersByTime(600)
    check('a', config)

    expect(check('a', config).allowed).toBe(false)

    /**
     * Advance to t=1050. The window is now [50, 1050], so BOTH t=0 hits have
     * aged out and only the t=600 one survives — freeing exactly two slots.
     *
     * A fixed window would instead have reset the whole counter at t=1000,
     * freeing all three and permitting a double burst across the boundary.
     * Asserting *two* rather than *three* is what distinguishes the two
     * algorithms.
     */
    vi.advanceTimersByTime(450)

    expect(check('a', config).allowed).toBe(true) // slot 1 of 2
    expect(check('a', config).allowed).toBe(true) // slot 2 of 2
    expect(check('a', config).allowed).toBe(false) // window full again
  })

  it('does not count blocked requests against the window', () => {
    for (let i = 0; i < 3; i++) check('a', config)

    // Hammering while blocked must not extend the block.
    for (let i = 0; i < 20; i++) check('a', config)

    vi.advanceTimersByTime(1001)

    expect(check('a', config).allowed).toBe(true)
  })

  it('emits the standard headers, and Retry-After only when blocked', () => {
    const ok = headers(check('a', config))

    expect(ok['X-RateLimit-Limit']).toBe('3')
    expect(ok).not.toHaveProperty('Retry-After')

    for (let i = 0; i < 3; i++) check('a', config)
    const blocked = headers(check('a', config))

    expect(blocked['X-RateLimit-Remaining']).toBe('0')
    expect(blocked).toHaveProperty('Retry-After')
  })

  it('counts what it checked and blocked', () => {
    for (let i = 0; i < 5; i++) check('a', config)

    const s = snapshot()

    expect(s.checked).toBe(5)
    expect(s.blocked).toBe(2)
    expect(s.trackedKeys).toBe(1)
  })
})
