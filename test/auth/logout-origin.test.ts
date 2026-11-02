import { after, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, type NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/owner-auth/session";
import { POST as logout } from "@/app/api/logout/route";

// Sign-out answers with a header that clears the session cookie. The cookie is
// SameSite=Strict, so a form another site submits carries no cookie, but a
// browser can still apply the clearing header in the answer, so without a check
// another site could end the owner's session. The route accepts the POST only
// when Sec-Fetch-Site is "same-origin" or "none", or Origin equals the
// deployment's own origin, and answers 403 otherwise.

// What a handler reads under `next start -H 127.0.0.1` (login-redirect.test.ts):
// req.nextUrl says localhost, while the Host header carries the host the
// browser used, and the sidebar's sign-out form sends that host's origin.
const SEEN_URL = "http://localhost:43117/api/logout";
const HOST = "127.0.0.1:43117";
const OWN_ORIGIN = `http://${HOST}`;

const savedMode = process.env.ATLAS_MODE;
after(() => {
  if (savedMode === undefined) delete process.env.ATLAS_MODE;
  else process.env.ATLAS_MODE = savedMode;
});

function signOut(headers: Record<string, string>): Promise<NextResponse> {
  return logout(new NextRequest(SEEN_URL, { method: "POST", headers }));
}

const refused: [string, Record<string, string>][] = [
  [
    "a form on another site (Sec-Fetch-Site cross-site)",
    { host: HOST, "sec-fetch-site": "cross-site", origin: "https://evil.example" },
  ],
  [
    "another origin on the same site (Sec-Fetch-Site same-site)",
    { host: HOST, "sec-fetch-site": "same-site", origin: "http://127.0.0.1:8080" },
  ],
  ["a browser that sends no Sec-Fetch-Site, Origin of another site", { host: HOST, origin: "https://evil.example" }],
  ["Origin null", { host: HOST, origin: "null" }],
  ["neither header", { host: HOST }],
  [
    "Origin of the host the handler's URL reads, not the one the browser used",
    { host: HOST, origin: "http://localhost:43117" },
  ],
  [
    "Origin of the same host over the other scheme",
    { host: "atlas.example", "x-forwarded-host": "atlas.example", "x-forwarded-proto": "https", origin: "http://atlas.example" },
  ],
  [
    "Origin null against a forwarded scheme that has no origin",
    { host: HOST, "x-forwarded-proto": "javascript", origin: "null" },
  ],
];

const accepted: [string, Record<string, string>][] = [
  [
    "the sidebar form in a browser that sends Sec-Fetch-Site",
    { host: HOST, "sec-fetch-site": "same-origin", origin: OWN_ORIGIN },
  ],
  ["a request the person started (Sec-Fetch-Site none)", { host: HOST, "sec-fetch-site": "none" }],
  ["a browser that sends no Sec-Fetch-Site, Origin of this deployment", { host: HOST, origin: OWN_ORIGIN }],
  [
    "the x-forwarded headers Next sets under next start",
    { host: HOST, "x-forwarded-host": HOST, "x-forwarded-proto": "http", origin: OWN_ORIGIN },
  ],
  [
    "behind a proxy that forwards the public host and scheme",
    { host: "10.0.0.7:3000", "x-forwarded-host": "atlas.example", "x-forwarded-proto": "https", origin: "https://atlas.example" },
  ],
  [
    "forwarded headers with more than one value (the first one is the browser's)",
    {
      host: "10.0.0.7:3000",
      "x-forwarded-host": "atlas.example, 10.0.0.7:3000",
      "x-forwarded-proto": "https, http",
      origin: "https://atlas.example",
    },
  ],
  [
    "a forwarded host that spells out the default port",
    { host: "10.0.0.7:3000", "x-forwarded-host": "atlas.example:443", "x-forwarded-proto": "https", origin: "https://atlas.example" },
  ],
];

for (const mode of ["unified", "owner"]) {
  test(`ATLAS_MODE=${mode}: a sign-out POST that is not from this deployment answers 403 and sets no cookie`, async () => {
    process.env.ATLAS_MODE = mode;
    for (const [what, headers] of refused) {
      const res = await signOut(headers);
      assert.equal(res.status, 403, what);
      assert.equal(res.headers.get("set-cookie"), null, what);
      assert.equal(res.headers.get("location"), null, what);
      assert.equal(await res.text(), "Sign-out refused: the request did not show that it came from this site.", what);
    }
  });

  test(`ATLAS_MODE=${mode}: a sign-out POST from this deployment answers 303 to /login and clears the session`, async () => {
    process.env.ATLAS_MODE = mode;
    for (const [what, headers] of accepted) {
      const res = await signOut(headers);
      assert.equal(res.status, 303, what);
      assert.equal(res.headers.get("location"), "/login", what);
      assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`), what);
    }
  });
}

// Where sign-in does not exist, the route answers 404 before it reads a header,
// so a cross-site POST learns nothing more than any other POST.
for (const [where, mode] of [
  ["ATLAS_MODE unset", undefined],
  ["ATLAS_MODE=public", "public"],
  ["ATLAS_MODE=local", "local"],
] as const) {
  test(`${where}: a cross-site sign-out POST answers 404 with an empty body and sets no cookie`, async () => {
    if (mode === undefined) delete process.env.ATLAS_MODE;
    else process.env.ATLAS_MODE = mode;
    const res = await signOut(refused[0][1]);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(await res.text(), "");
  });
}
