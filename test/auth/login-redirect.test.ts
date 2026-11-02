import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { UNKNOWN_CLIENT } from "@/lib/owner-auth/client-key";
import { hashPassword } from "@/lib/owner-auth/password";
import { clearAttempts } from "@/lib/owner-auth/ratelimit";
import { SESSION_COOKIE } from "@/lib/owner-auth/session";
import { POST as login } from "@/app/api/login/route";
import { POST as logout } from "@/app/api/logout/route";
import LoginPage from "@/app/login/page";

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

// These requests are built here, not received on a socket, so the limiter
// counts them all under one shared key, UNKNOWN_CLIENT
// (lib/owner-auth/client-key.ts). Each test starts with that key cleared, so
// its first MAX_ATTEMPTS (lib/owner-auth/ratelimit.ts) wrong passwords answer
// error=bad and the next one error=rate. A test that sends more wrong passwords
// than that, each meant as a first attempt, clears the key before each one; the
// rate-limit tests below fill it.
beforeEach(() => clearAttempts(UNKNOWN_CLIENT));

function loginRequest(fields: Record<string, string>): NextRequest {
  return new NextRequest(`${SEEN_ORIGIN}/api/login`, {
    method: "POST",
    body: new URLSearchParams(fields),
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

// The callback used to be dropped here, so after one wrong password the right
// one landed the owner on / instead of the page they had asked for.
test("a bad password goes back to /login with the callback, as a relative Location", async () => {
  const res = await login(loginRequest({ password: "wrong", callbackUrl: "/roadmap" }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?error=bad&callbackUrl=%2Froadmap");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("a bad password carries no callback that would leave the origin, and none for /", async () => {
  for (const callbackUrl of ["//evil.example", "/.//evil.example", "/x/..//evil.example", "https://evil.example/", "", "/"]) {
    // Six payloads, more than MAX_ATTEMPTS: each is a first wrong attempt.
    clearAttempts(UNKNOWN_CLIENT);
    const res = await login(loginRequest({ password: "wrong", callbackUrl }));
    assert.equal(res.headers.get("location"), "/login?error=bad", JSON.stringify(callbackUrl));
  }
});

test("after a bad password the login page posts the callback again, and the right password lands on it", async () => {
  const callbackUrl = "/roadmap?area=x#top";
  const failed = await login(loginRequest({ password: "wrong", callbackUrl }));
  const back = new URL(failed.headers.get("location") ?? "", SEEN_ORIGIN);
  assert.equal(back.pathname, "/login");
  assert.equal(back.searchParams.get("error"), "bad");

  const html = renderToStaticMarkup(
    await LoginPage({ searchParams: Promise.resolve(Object.fromEntries(back.searchParams)) })
  );
  assert.match(html, /Incorrect password\./);
  const posted = html.match(/<input[^>]*name="callbackUrl"[^>]*value="([^"]*)"/)?.[1];
  assert.equal(posted, callbackUrl);

  const res = await login(loginRequest({ password: PASSWORD, callbackUrl: posted ?? "" }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), callbackUrl);
});

test("a rate-limited client goes back to /login with a relative Location and Retry-After", async () => {
  const req = () =>
    new NextRequest(`${SEEN_ORIGIN}/api/login`, {
      method: "POST",
      body: new URLSearchParams({ password: "wrong" }),
    });
  let res = await login(req());
  for (let i = 0; i < 10 && res.headers.get("location") !== "/login?error=rate"; i++) res = await login(req());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?error=rate");
  assert.ok(Number(res.headers.get("retry-after")) > 0);
});

test("a rate-limited client keeps the callback too", async () => {
  const req = () =>
    new NextRequest(`${SEEN_ORIGIN}/api/login`, {
      method: "POST",
      body: new URLSearchParams({ password: "wrong", callbackUrl: "/todos" }),
    });
  let res = await login(req());
  for (let i = 0; i < 10 && !res.headers.get("location")?.startsWith("/login?error=rate"); i++) res = await login(req());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?error=rate&callbackUrl=%2Ftodos");
  assert.ok(Number(res.headers.get("retry-after")) > 0);
});

test("logout answers 303 to /login with a relative Location and clears the session", async () => {
  const res = await logout(
    new NextRequest(`${SEEN_ORIGIN}/api/logout`, { method: "POST", headers: { "sec-fetch-site": "same-origin" } })
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");
  assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=;`));
});
