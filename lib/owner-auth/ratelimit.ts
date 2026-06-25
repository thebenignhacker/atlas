/**
 * Best-effort in-memory login rate limiter. Edge/Node-safe (plain Map).
 *
 * Caveat — serverless: this state lives per-instance and resets on cold start, so
 * it is NOT a hard global limit. It raises the cost of casual brute force; the
 * PRIMARY defense is the slow scrypt hash (./password) plus a strong password.
 * For a hard cross-instance limit, back this with Vercel KV / Upstash (see
 * .env.example). Kept dependency-free here so "basic password" needs no extra infra.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

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

export function recordFailure(key: string, now: number = Date.now()): void {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    b.count += 1;
  }
}

export function clearAttempts(key: string): void {
  buckets.delete(key);
}
