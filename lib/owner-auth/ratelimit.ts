/**
 * Best-effort in-memory login rate limiter. Edge/Node-safe (plain Map).
 *
 * Caveat — serverless: this state lives per-instance and resets on cold start, so
 * it is NOT a hard global limit. It raises the cost of casual brute force; the
 * PRIMARY defense is the slow scrypt hash (./password) plus a strong password.
 * For a hard cross-instance limit, back this with Vercel KV / Upstash (see
 * .env.example). Kept dependency-free here so "basic password" needs no extra infra.
 *
 * The login route keys attempts with ./client-key, never with a header the
 * client chooses. Each recorded failure first drops every bucket whose window
 * has passed, so after it the map holds only keys with a failure inside their
 * current window.
 */

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSec: number } {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) return { allowed: true, retryAfterSec: 0 };
  if (b.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Removes every bucket whose window has passed at `now`. */
function dropExpired(now: number): void {
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
}

export function recordFailure(key: string, now: number = Date.now()): void {
  dropExpired(now);
  const b = buckets.get(key);
  if (b) b.count += 1;
  else buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
}

export function clearAttempts(key: string): void {
  buckets.delete(key);
}

/** How many keys the limiter holds a bucket for. */
export function trackedKeyCount(): number {
  return buckets.size;
}
