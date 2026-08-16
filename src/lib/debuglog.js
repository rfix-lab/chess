/**
 * DEBUG-logging, gated by env flag.
 * Enable: DEBUG=1 (or DEBUG=true) in the process environment.
 * One single source — do NOT scatter raw console.log for diagnostics.
 */
const ENABLED = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

export function log(...args) {
  if (!ENABLED) return;
  const ts = new Date().toISOString();
  console.log(`[DEBUG] ${ts}`, ...args);
}
