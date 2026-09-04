/**
 * Owner-session signing/verification. Edge-runtime-safe: uses ONLY Web Crypto
 * (crypto.subtle) and btoa/atob, so it can run in the proxy (edge) as well as in
 * Node route handlers. The password hash (scrypt) lives in a SEPARATE module
 * (./password) that is never imported here, so no Node-only crypto leaks into the
 * edge bundle.
 *
 * A session is a stateless, signed token: base64url(payload) "." base64url(HMAC).
 * The payload carries only an expiry — there is no per-user data (single owner).
 * Tampering changes the HMAC; subtle.verify is constant-time, so a forged or
 * truncated token is rejected without a timing signal. AUTH_SECRET is the signing
 * key; without it, verification always fails (fail closed).
 */

const COOKIE_NAME = "atlas_owner";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function toBytes(s: string) {
  // Copy into a fresh ArrayBuffer-backed view — TextEncoder returns
  // Uint8Array<ArrayBufferLike>, which Web Crypto's BufferSource type rejects.
  return new Uint8Array(new TextEncoder().encode(s));
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str: string) {
  try {
    const s = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Mint a signed session token valid for SESSION_TTL_MS. Throws if AUTH_SECRET unset. */
export async function signSession(now: number = Date.now()): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const payload = toBytes(JSON.stringify({ exp: now + SESSION_TTL_MS }));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  return `${b64url(payload)}.${b64url(sig)}`;
}

/** Verify a session token's signature AND expiry. False on any defect (fail closed). */
export async function verifySession(
  token: string | undefined | null,
  now: number = Date.now()
): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = fromB64url(token.slice(0, dot));
  const sig = fromB64url(token.slice(dot + 1));
  if (!payload || !sig) return false;
  const key = await hmacKey(secret);
  // Constant-time signature check.
  const ok = await crypto.subtle.verify("HMAC", key, sig, payload);
  if (!ok) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(payload)) as { exp?: unknown };
    // Number.isFinite rejects a forged `exp: Infinity` (a never-expiring claim).
    return typeof data.exp === "number" && Number.isFinite(data.exp) && now < data.exp;
  } catch {
    return false;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;

/** Set-Cookie value for a fresh session. */
export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/** Set-Cookie value that clears the session. */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
