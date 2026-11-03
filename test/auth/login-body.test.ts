import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { UNKNOWN_CLIENT } from "@/lib/owner-auth/client-key";
import { hashPassword } from "@/lib/owner-auth/password";
import { MAX_ATTEMPTS, clearAttempts } from "@/lib/owner-auth/ratelimit";
import { POST as login } from "@/app/api/login/route";

// POST /api/login reads its body with req.formData(), which rejects with a
// TypeError when the body is not form data. The route let that rejection
// escape, and `next start` answered with a 500 and an empty body: to a
// text/plain or application/json body, and to a text/plain body from a client
// that had reached the sign-in limit. Each body below is one that
// req.formData() rejects; the route answers it as a failed sign-in.

const PASSWORD = "FAKE-owner-pass";
process.env.ATLAS_MODE = "owner";
process.env.AUTH_SECRET = "FAKE-test-secret-not-a-real-one";
process.env.OWNER_PASSWORD_HASH = hashPassword(PASSWORD);

const SEEN_ORIGIN = "http://localhost:43117";

// These requests are built here, not received on a socket, so the limiter
// counts them all under one key, UNKNOWN_CLIENT (lib/owner-auth/client-key.ts).
beforeEach(() => clearAttempts(UNKNOWN_CLIENT));

function loginRequest(headers: Record<string, string>, body: BodyInit): NextRequest {
  return new NextRequest(`${SEEN_ORIGIN}/api/login`, { method: "POST", headers, body });
}

function form(fields: Record<string, string>): NextRequest {
  return loginRequest({}, new URLSearchParams(fields));
}

// The JSON body and the body without a Content-Type carry the right password,
// in a shape req.formData() does not read.
const NOT_FORM_DATA: [string, () => NextRequest][] = [
  ["text/plain", () => loginRequest({ "content-type": "text/plain" }, "x")],
  [
    "application/json",
    () => loginRequest({ "content-type": "application/json" }, JSON.stringify({ password: PASSWORD })),
  ],
  ["no Content-Type", () => loginRequest({}, new TextEncoder().encode(`password=${PASSWORD}`))],
  [
    "multipart that does not parse",
    () => loginRequest({ "content-type": "multipart/form-data; boundary=FAKE-boundary" }, "x"),
  ],
];

// The tests below rest on this: a form that parsed but held no password would
// get the same error=bad answer, so the 303 alone does not show that
// req.formData() refused the body.
test("req.formData() rejects each of these bodies with a TypeError", async () => {
  for (const [name, request] of NOT_FORM_DATA) {
    await assert.rejects(request().formData(), TypeError, name);
  }
});

test("a body that is not form data is a failed sign-in: 303 to /login?error=bad and no session", async () => {
  for (const [name, request] of NOT_FORM_DATA) {
    // Four bodies, each meant as a first attempt.
    clearAttempts(UNKNOWN_CLIENT);
    const res = await login(request());
    assert.equal(res.status, 303, name);
    assert.equal(res.headers.get("location"), "/login?error=bad", name);
    assert.equal(res.headers.get("set-cookie"), null, name);
  }
});

test("a client at the sign-in limit gets error=rate for a body that is not form data, as for a form", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal((await login(form({ password: "wrong" }))).headers.get("location"), "/login?error=bad");
  }
  assert.equal((await login(form({ password: "wrong" }))).headers.get("location"), "/login?error=rate");
  for (const [name, request] of NOT_FORM_DATA) {
    const res = await login(request());
    assert.equal(res.status, 303, name);
    assert.equal(res.headers.get("location"), "/login?error=rate", name);
    assert.ok(Number(res.headers.get("retry-after")) > 0, name);
    assert.equal(res.headers.get("set-cookie"), null, name);
  }
});

test("a body that is not form data counts toward the sign-in limit like a wrong password", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await login(loginRequest({ "content-type": "text/plain" }, "x"));
    assert.equal(res.headers.get("location"), "/login?error=bad");
  }
  // Once the limit applies, the right password sent as a form is refused too.
  const res = await login(form({ password: PASSWORD }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?error=rate");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("the right password sent as a form still signs in", async () => {
  const res = await login(form({ password: PASSWORD, callbackUrl: "/roadmap" }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/roadmap");
  assert.ok(res.headers.get("set-cookie"));
});
