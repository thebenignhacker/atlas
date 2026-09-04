import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for the owner gate. NODE-ONLY (scrypt) — imported only by the
 * login route (runtime = "nodejs") and the hash-generation script, never by edge
 * proxy. scrypt is a deliberately slow, memory-hard KDF, so even if the
 * OWNER_PASSWORD_HASH env value leaks, brute-forcing the password is expensive.
 *
 * Stored format: `scrypt:<saltB64url>:<hashB64url>`. The salt is per-password and
 * stored alongside the hash. Verification is constant-time (timingSafeEqual).
 */

const KEYLEN = 32;
const COST = 16384; // scrypt N (CPU/memory cost). 2^14 — strong but sub-second.

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, KEYLEN, { N: COST });
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

/**
 * Constant-time verify of a password against a stored `scrypt:salt:hash` string.
 * Returns false on any malformed input rather than throwing — the caller treats
 * false as "denied".
 */
export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "base64url");
    expected = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize("NFKC"), salt, KEYLEN, { N: COST });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
