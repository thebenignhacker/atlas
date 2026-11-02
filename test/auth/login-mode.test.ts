import { after, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { hashPassword } from "@/lib/owner-auth/password";
import { SESSION_COOKIE } from "@/lib/owner-auth/session";
import { POST as login } from "@/app/api/login/route";
import { POST as logout } from "@/app/api/logout/route";
import LoginPage, { generateMetadata } from "@/app/login/page";
import { proxy } from "@/proxy";

// Sign-in exists only where lib/mode.ts enables auth controls: unified and
// owner mode. In public mode (also what an unset ATLAS_MODE resolves to) and in
// local mode there is nothing to sign in to, so the login page and both routes
// answer 404 and set no cookie, whatever secrets the environment holds. The
// proxy answers there before a route runs: 404 on the two routes without a
// look at the method, and /login rewritten to the not-found route. Where sign-in is
// enabled but a secret is missing, the visitor reads one neutral sentence and
// the server log names the two variables, never their values; in owner mode
// the proxy answers so on the login surfaces too.

const PASSWORD = "FAKE-owner-pass";
const SECRET = "FAKE-test-secret-not-a-real-one";
const HASH = hashPassword(PASSWORD);
const ORIGIN = "http://localhost:43117";

// The digest next/navigation's notFound() throws, read from the real throw
// (next 16.2.7); the framework answers it with a 404 and app/not-found.tsx.
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

type Env = { ATLAS_MODE?: string; AUTH_SECRET?: string; OWNER_PASSWORD_HASH?: string };
const KEYS = ["ATLAS_MODE", "AUTH_SECRET", "OWNER_PASSWORD_HASH"] as const;
const saved: Env = {
  ATLAS_MODE: process.env.ATLAS_MODE,
  AUTH_SECRET: process.env.AUTH_SECRET,
  OWNER_PASSWORD_HASH: process.env.OWNER_PASSWORD_HASH,
};

function setEnv(env: Env): void {
  for (const key of KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
after(() => setEnv(saved));

// Every request here carries the right password, so none records a failed
// attempt and the rate limit never answers first.
function loginRequest(password: string): NextRequest {
  return new NextRequest(`${ORIGIN}/api/login`, {
    method: "POST",
    body: new URLSearchParams({ password, callbackUrl: "/" }),
  });
}

// The sidebar's sign-out form, sent from the deployment's own page; the
// requests the route refuses are in logout-origin.test.ts.
function logoutRequest(): NextRequest {
  return new NextRequest(`${ORIGIN}/api/logout`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", origin: ORIGIN },
  });
}

function digestOf(err: unknown): unknown {
  return (err as { digest?: unknown }).digest;
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
const LOGIN_SURFACES = ["/login", "/api/login", "/api/logout"];

function proxyRequest(path: string, method = "GET"): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { method });
}

test("the pinned digest is the one next/navigation's notFound() throws", () => {
  assert.throws(
    () => notFound(),
    (err: unknown) => {
      assert.equal(digestOf(err), NOT_FOUND_DIGEST);
      return true;
    }
  );
});

const noSignIn: [string, string | undefined][] = [
  ["ATLAS_MODE unset", undefined],
  ["ATLAS_MODE=public", "public"],
  ["ATLAS_MODE=local", "local"],
];
const held: [string, Env][] = [
  ["no secrets", {}],
  ["both secrets set", { AUTH_SECRET: SECRET, OWNER_PASSWORD_HASH: HASH }],
];

for (const [where, mode] of noSignIn) {
  test(`${where}: POST /api/login answers 404 with an empty body and sets no cookie`, async () => {
    for (const [secrets, env] of held) {
      setEnv({ ATLAS_MODE: mode, ...env });
      const res = await login(loginRequest(PASSWORD));
      assert.equal(res.status, 404, secrets);
      assert.equal(res.headers.get("set-cookie"), null, secrets);
      assert.equal(await res.text(), "", secrets);
    }
  });

  test(`${where}: POST /api/logout answers 404 with an empty body and sets no cookie`, async () => {
    for (const [secrets, env] of held) {
      setEnv({ ATLAS_MODE: mode, ...env });
      const res = await logout(logoutRequest());
      assert.equal(res.status, 404, secrets);
      assert.equal(res.headers.get("set-cookie"), null, secrets);
      assert.equal(await res.text(), "", secrets);
    }
  });

  test(`${where}: the login page rejects with the not-found signal`, async () => {
    setEnv({ ATLAS_MODE: mode });
    await assert.rejects(LoginPage({ searchParams: Promise.resolve({}) }), (err: unknown) => {
      assert.equal(digestOf(err), NOT_FOUND_DIGEST);
      return true;
    });
  });

  // The not-found answer must not carry the page's title into the browser tab.
  test(`${where}: the login page's metadata rejects with the not-found signal`, async () => {
    setEnv({ ATLAS_MODE: mode });
    await assert.rejects(generateMetadata(), (err: unknown) => {
      assert.equal(digestOf(err), NOT_FOUND_DIGEST);
      return true;
    });
  });

  // The routes export only POST. The framework answered the other methods
  // before the routes' own check ran: 405, and 204 with "Allow: OPTIONS, POST"
  // for OPTIONS. The proxy answers first.
  test(`${where}: the proxy answers 404 to ${METHODS.join(", ")} on /api/login and /api/logout`, async () => {
    for (const [secrets, env] of held) {
      setEnv({ ATLAS_MODE: mode, ...env });
      for (const path of ["/api/login", "/api/logout"]) {
        for (const method of METHODS) {
          const label = `${secrets}: ${method} ${path}`;
          const res = await proxy(proxyRequest(path, method));
          assert.equal(res.status, 404, label);
          assert.equal(res.headers.get("x-middleware-next"), null, `${label}: the route never runs`);
          assert.equal(res.headers.get("set-cookie"), null, label);
          assert.equal(res.headers.get("allow"), null, label);
          assert.equal(await res.text(), "", label);
        }
      }
    }
  });

  // Under next 16.2.7 the page's notFound() reached the browser as an empty
  // <html id="__next_error__"> document that only the client bundle fills in.
  // The not-found route renders on the server, inside the shell.
  test(`${where}: the proxy rewrites /login to the not-found route for ${METHODS.join(", ")}`, async () => {
    for (const [secrets, env] of held) {
      setEnv({ ATLAS_MODE: mode, ...env });
      for (const method of METHODS) {
        const label = `${secrets}: ${method} /login`;
        const res = await proxy(proxyRequest("/login?callbackUrl=%2Froadmap&error=bad", method));
        const target = res.headers.get("x-middleware-rewrite");
        assert.ok(target, `${label}: a rewrite`);
        const url = new URL(target);
        assert.equal(url.origin, ORIGIN, `${label}: an internal rewrite`);
        assert.equal(url.pathname, "/_not-found", label);
        assert.equal(res.headers.get("set-cookie"), null, label);
      }
    }
  });

  test(`${where}: the proxy passes other paths through`, async () => {
    setEnv({ ATLAS_MODE: mode });
    for (const path of ["/", "/roadmap", "/login/extra", "/api/roadmap"]) {
      const res = await proxy(proxyRequest(path));
      assert.equal(res.headers.get("x-middleware-next"), "1", path);
    }
  });
}

const missing: [string, Env][] = [
  ["both secrets unset", {}],
  ["OWNER_PASSWORD_HASH unset", { AUTH_SECRET: SECRET }],
  ["AUTH_SECRET unset", { OWNER_PASSWORD_HASH: HASH }],
];

function assertNeutralBody(body: string): void {
  assert.doesNotMatch(body, /misconfig/i);
  assert.equal(body, "Sign-in is unavailable.");
}

function assertOperatorLine(calls: ReadonlyArray<{ arguments: unknown[] }>, env: Env): void {
  assert.equal(calls.length, 1, "one server log line");
  const line = calls[0].arguments.map(String).join(" ");
  assert.match(line, /\bAUTH_SECRET\b/);
  assert.match(line, /\bOWNER_PASSWORD_HASH\b/);
  for (const value of [env.AUTH_SECRET, env.OWNER_PASSWORD_HASH]) {
    if (value) assert.ok(!line.includes(value), "the log line carries no secret value");
  }
}

for (const [what, env] of missing) {
  test(`ATLAS_MODE=unified, ${what}: POST /api/login answers 503 with a neutral body and logs the two names`, async (t) => {
    setEnv({ ATLAS_MODE: "unified", ...env });
    const logged = t.mock.method(console, "error", () => {});
    const res = await login(loginRequest(PASSWORD));
    assert.equal(res.status, 503);
    assertNeutralBody(await res.text());
    assert.equal(res.headers.get("set-cookie"), null);
    assertOperatorLine(logged.mock.calls, env);
  });

  test(`ATLAS_MODE=owner, ${what}: the proxy answers 503 for /roadmap with a neutral body and logs the two names`, async (t) => {
    setEnv({ ATLAS_MODE: "owner", ...env });
    const logged = t.mock.method(console, "error", () => {});
    const res = await proxy(new NextRequest(`${ORIGIN}/roadmap`));
    assert.equal(res.status, 503);
    assertNeutralBody(await res.text());
    assertOperatorLine(logged.mock.calls, env);
  });

  // The README says owner mode serves nothing (503) without the two secrets.
  // The proxy let the login surfaces through before that check, so /login
  // served a password form that could not succeed and /api/logout answered 303.
  test(`ATLAS_MODE=owner, ${what}: the proxy answers 503 on the login surfaces too`, async (t) => {
    setEnv({ ATLAS_MODE: "owner", ...env });
    for (const path of LOGIN_SURFACES) {
      for (const method of METHODS) {
        const label = `${method} ${path}`;
        const logged = t.mock.method(console, "error", () => {});
        const res = await proxy(proxyRequest(path, method));
        assert.equal(res.status, 503, label);
        assert.equal(res.headers.get("x-middleware-next"), null, `${label}: the route never runs`);
        assert.equal(res.headers.get("set-cookie"), null, label);
        assertNeutralBody(await res.text());
        assertOperatorLine(logged.mock.calls, env);
        logged.mock.restore();
      }
    }
  });
}

const signInWithoutSession: [string, Env][] = [
  ["ATLAS_MODE=unified, no secrets", { ATLAS_MODE: "unified" }],
  ["ATLAS_MODE=unified, both secrets set", { ATLAS_MODE: "unified", AUTH_SECRET: SECRET, OWNER_PASSWORD_HASH: HASH }],
  ["ATLAS_MODE=owner, both secrets set", { ATLAS_MODE: "owner", AUTH_SECRET: SECRET, OWNER_PASSWORD_HASH: HASH }],
];

for (const [where, env] of signInWithoutSession) {
  test(`${where}: the proxy lets the login surfaces through without a session`, async () => {
    setEnv(env);
    for (const path of LOGIN_SURFACES) {
      const res = await proxy(proxyRequest(path));
      assert.equal(res.headers.get("x-middleware-next"), "1", path);
    }
  });
}

for (const mode of ["unified", "owner"]) {
  test(`ATLAS_MODE=${mode}: the login page renders the password form under its own title`, async () => {
    setEnv({ ATLAS_MODE: mode });
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    assert.match(html, /<form[^>]*action="\/api\/login"/);
    assert.match(html, /<input[^>]*type="password"/);
    assert.equal((await generateMetadata()).title, "Owner access");
  });

  test(`ATLAS_MODE=${mode}: sign-in and sign-out still answer`, async () => {
    setEnv({ ATLAS_MODE: mode, AUTH_SECRET: SECRET, OWNER_PASSWORD_HASH: HASH });
    const signIn = await login(loginRequest(PASSWORD));
    assert.equal(signIn.status, 303);
    assert.equal(signIn.headers.get("location"), "/");
    assert.match(signIn.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=`));
    const signOut = await logout(logoutRequest());
    assert.equal(signOut.status, 303);
    assert.equal(signOut.headers.get("location"), "/login");
    assert.match(signOut.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=;`));
  });
}
