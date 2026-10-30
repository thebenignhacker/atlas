import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/owner-auth/password";
import { SESSION_COOKIE } from "@/lib/owner-auth/session";
import { POST as login } from "@/app/api/login/route";
import { POST as logout } from "@/app/api/logout/route";

// Under `next start -H 127.0.0.1` a route handler's req.nextUrl.origin reads
// http://localhost:<port>, not the host the browser used. A redirect built from
// it lands the owner on localhost, where the session cookie just set for
// 127.0.0.1 is not sent, so the login looks failed. The login and logout routes
// answer with a relative Location instead; the requests below carry the
// localhost origin a handler sees.

const PASSWORD = "FAKE-owner-pass";
process.env.ATLAS_MODE = "unified";
process.env.AUTH_SECRET = "FAKE-test-secret-not-a-real-one";
process.env.OWNER_PASSWORD_HASH = hashPassword(PASSWORD);

const SEEN_ORIGIN = "http://localhost:43117";
let client = 0;

function loginRequest(fields: Record<string, string>): NextRequest {
  return new NextRequest(`${SEEN_ORIGIN}/api/login`, {
    method: "POST",
    body: new URLSearchParams(fields),
    // A fresh client per request, so the rate limit only trips where a test asks.
    headers: { "x-forwarded-for": `198.51.100.${++client}` },
  });
}

test("a good login answers 303 with the callback as a relative Location and sets the session", async () => {
  const res = await login(loginRequest({ password: PASSWORD, callbackUrl: "/roadmap?area=x#top" }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/roadmap?area=x#top");
  assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=`));
});

test("a callback that would leave the origin falls back to /", async () => {
  for (const callbackUrl of ["//evil.example", "/.//evil.example", "/x/..//evil.example", "https://evil.example/", ""]) {
    const res = await login(loginRequest({ password: PASSWORD, callbackUrl }));
    assert.equal(res.headers.get("location"), "/", JSON.stringify(callbackUrl));
  }
});

test("a bad password goes back to /login with a relative Location", async () => {
  const res = await login(loginRequest({ password: "wrong", callbackUrl: "/roadmap" }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?error=bad");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("a rate-limited client goes back to /login with a relative Location and Retry-After", async () => {
  const req = () =>
    new NextRequest(`${SEEN_ORIGIN}/api/login`, {
      method: "POST",
      body: new URLSearchParams({ password: "wrong" }),
      headers: { "x-forwarded-for": "198.51.100.250" },
    });
  let res = await login(req());
  for (let i = 0; i < 10 && res.headers.get("location") !== "/login?error=rate"; i++) res = await login(req());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?error=rate");
  assert.ok(Number(res.headers.get("retry-after")) > 0);
});

test("logout answers 303 to /login with a relative Location and clears the session", async () => {
  const res = await logout();
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");
  assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=;`));
});
