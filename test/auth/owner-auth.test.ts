import { test } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test-secret-do-not-use-in-prod-aaaaaaaaaaaa";

import { hashPassword, verifyPassword } from "@/lib/owner-auth/password";
import { signSession, verifySession } from "@/lib/owner-auth/session";

// The owner gate is the only thing between the public internet and full private
// data. These tests pin the security-critical properties: correct accept/reject,
// constant-time-safe verification, tamper rejection, and expiry.

test("verifyPassword accepts the right password, rejects everything else", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("wrong password", stored), false);
  assert.equal(verifyPassword("", stored), false);
  assert.equal(verifyPassword("correct horse battery staple", undefined), false);
});

test("verifyPassword rejects malformed stored hashes (fail closed)", () => {
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  assert.equal(verifyPassword("x", "scrypt:only-two"), false);
  assert.equal(verifyPassword("x", "bcrypt:salt:hash"), false);
  assert.equal(verifyPassword("x", "scrypt::"), false);
});

test("hashPassword salts — same password hashes differently each time", () => {
  const a = hashPassword("same");
  const b = hashPassword("same");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("same", a), true);
  assert.equal(verifyPassword("same", b), true);
});

test("session round-trips: a freshly signed token verifies", async () => {
  const token = await signSession();
  assert.equal(await verifySession(token), true);
});

test("session rejects a tampered payload or signature", async () => {
  const token = await signSession();
  const [payload, sig] = token.split(".");
  // flip the payload (different exp) but keep the old signature
  const forgedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12 })).toString(
    "base64url"
  );
  assert.equal(await verifySession(`${forgedPayload}.${sig}`), false);
  // flip the signature
  assert.equal(await verifySession(`${payload}.${sig.slice(0, -2)}xx`), false);
  // garbage
  assert.equal(await verifySession("not-a-token"), false);
  assert.equal(await verifySession(undefined), false);
  assert.equal(await verifySession(""), false);
});

test("session expires", async () => {
  const t0 = 1_000_000_000_000;
  const token = await signSession(t0);
  assert.equal(await verifySession(token, t0 + 1000), true); // within TTL
  assert.equal(await verifySession(token, t0 + 8 * 24 * 60 * 60 * 1000), false); // past 7d
});

test("session forged under a different secret is rejected", async () => {
  const token = await signSession();
  const saved = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "a-completely-different-secret-bbbbbbbbbbbb";
  assert.equal(await verifySession(token), false);
  process.env.AUTH_SECRET = saved;
});

test("no AUTH_SECRET => verification fails closed", async () => {
  const token = await signSession();
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  assert.equal(await verifySession(token), false);
  process.env.AUTH_SECRET = saved;
});
