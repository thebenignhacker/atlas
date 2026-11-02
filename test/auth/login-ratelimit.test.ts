import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest, type NextResponse } from "next/server";
import { hashPassword } from "@/lib/owner-auth/password";

// The sign-in limiter measured the way `next start` serves the login route: a
// Node HTTP server on loopback whose handler fills x-forwarded-for from the
// socket only when the client sent none (next/dist/server/base-server.js does
// the same with `??=`), copies every request header into the NextRequest and
// calls the route. Every request below comes from 127.0.0.1, whatever
// x-forwarded-for value it carries, and no trusted-proxy header is declared.

const PASSWORD = "FAKE-owner-pass";

let login: (req: NextRequest) => Promise<NextResponse>;
let origin = "";

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  req.headers["x-forwarded-for"] ??= req.socket.remoteAddress;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const answer = await login(
    new NextRequest(`${origin}${req.url}`, { method: req.method, headers, body: Buffer.concat(chunks) })
  );
  res.statusCode = answer.status;
  const location = answer.headers.get("location");
  if (location) res.setHeader("location", location);
  res.end();
}

const server = createServer((req, res) => {
  serve(req, res).catch((err: unknown) => {
    res.statusCode = 500;
    res.end(String(err));
  });
});

before(async () => {
  process.env.ATLAS_MODE = "owner";
  process.env.AUTH_SECRET = "FAKE-test-secret-not-a-real-one";
  process.env.OWNER_PASSWORD_HASH = hashPassword(PASSWORD);
  // The trusted-proxy setting is read once, when the login route's modules
  // load, so it is cleared before the route is imported.
  delete process.env.ATLAS_TRUSTED_PROXY_HEADER;
  ({ POST: login } = await import("@/app/api/login/route"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

/** POST a wrong password; returns where the route sends the browser. */
async function wrongPassword(forwardedFor: string): Promise<string | null> {
  const res = await fetch(`${origin}/api/login`, {
    method: "POST",
    body: new URLSearchParams({ password: "wrong" }),
    headers: { "x-forwarded-for": forwardedFor },
    redirect: "manual",
  });
  await res.arrayBuffer();
  return res.headers.get("location");
}

test("a fresh x-forwarded-for value per attempt does not reset the limit: the sixth wrong password from one socket is refused", async () => {
  const seen: (string | null)[] = [];
  for (let i = 1; i <= 6; i++) seen.push(await wrongPassword(`203.0.113.${i}`));
  assert.deepEqual(seen, [
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=bad",
    "/login?error=rate",
  ]);
  // One more value the client has not used yet is refused the same way.
  assert.equal(await wrongPassword("198.51.100.77"), "/login?error=rate");
});
