import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, type NextResponse } from "next/server";
import { hashPassword } from "@/lib/owner-auth/password";

// A deployment behind a proxy declares the header that proxy sets with
// ATLAS_TRUSTED_PROXY_HEADER. The setting is read once, when the login route's
// modules load, so this file sets it before importing the route. The requests
// stand for what such a proxy forwards: the client's own x-forwarded-for value
// first, the address the proxy saw last.

const ORIGIN = "http://localhost:43117";

let login: (req: NextRequest) => Promise<NextResponse>;

before(async () => {
  process.env.ATLAS_MODE = "owner";
  process.env.AUTH_SECRET = "FAKE-test-secret-not-a-real-one";
  process.env.OWNER_PASSWORD_HASH = hashPassword("FAKE-owner-pass");
  process.env.ATLAS_TRUSTED_PROXY_HEADER = "X-Forwarded-For";
  ({ POST: login } = await import("@/app/api/login/route"));
});

/** POST a wrong password; returns where the route sends the browser. */
async function wrongPassword(forwardedFor: string): Promise<string | null> {
  const res = await login(
    new NextRequest(`${ORIGIN}/api/login`, {
      method: "POST",
      body: new URLSearchParams({ password: "wrong" }),
      headers: { "x-forwarded-for": forwardedFor },
    })
  );
  return res.headers.get("location");
}

test("the right-most x-forwarded-for entry is the key: a new value prepended by the client does not reset it", async () => {
  const seen: (string | null)[] = [];
  for (let i = 1; i <= 6; i++) seen.push(await wrongPassword(`198.51.100.${i}, 203.0.113.7`));
  assert.deepEqual(seen, [
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=rate",
  ]);
  // Another address the proxy reports has its own count.
  assert.equal(await wrongPassword("198.51.100.1, 203.0.113.8"), "/login?error=bad");
});
