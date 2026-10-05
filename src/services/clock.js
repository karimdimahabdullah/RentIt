/**
 * Single source of "now". Every time check in the lifecycle uses this.
 * In production the offset is 0. For testing you can advance the clock
 * (dev route) or run a block at a fixed instant (daily job "now" override),
 * so expiry / overdue / auto-confirm can be tested without waiting days.
 *
 * Imported elsewhere as `import * as clock from './clock.js'` so call sites
 * keep the familiar clock.now() / clock.reset() namespace style.
 */
import { AsyncLocalStorage } from 'async_hooks';

const als = new AsyncLocalStorage();
let offsetMs = 0;

export function now() {
  const s = als.getStore();
  if (s && s.now) return new Date(s.now);
  return new Date(Date.now() + offsetMs);
}
export function runAt(date, fn) { return als.run({ now: new Date(date).getTime() }, fn); }
export function advance(ms) { offsetMs += ms; return offsetMs; }
export function reset() { offsetMs = 0; }
export function offset() { return offsetMs; }
