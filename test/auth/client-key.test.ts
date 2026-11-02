import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  PEER_HEADER,
  UNKNOWN_CLIENT,
  clientKey,
  parseTrustedProxyHeader,
} from "@/lib/owner-auth/client-key";

// The sign-in limiter's key. With no trusted-proxy header declared it is the
// TCP peer address, which lib/owner-auth/client-key.ts writes into PEER_HEADER
// as Node's HTTP server receives the request. With one declared it is the
// right-most entry of that header.

/**
 * Sends one request with `sent` to a server on loopback and returns the
 * headers that server received, copied the way Next copies them into the
 * NextRequest a route handler reads.
 */
async function headersReceivedOnLoopback(sent: Record<string, string>): Promise<Headers> {
  const received = new Headers();
  const server = createServer((req, res) => {
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) received.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: sent });
    await res.arrayBuffer();
  } finally {
    server.closeAllConnections();
    server.close();
  }
  return received;
}

test("with no trusted-proxy header declared, the key is the socket address, not x-forwarded-for", async () => {
  const headers = await headersReceivedOnLoopback({ "x-forwarded-for": "203.0.113.9" });
  assert.equal(headers.get("x-forwarded-for"), "203.0.113.9");
  assert.equal(clientKey(headers, null), "127.0.0.1");
});

test("a value the client sends in the peer header is replaced by the socket address", async () => {
  const headers = await headersReceivedOnLoopback({ [PEER_HEADER]: "203.0.113.9" });
  assert.equal(clientKey(headers, null), "127.0.0.1");
});

test("a request the server did not stamp gets the shared key, whatever it carries", () => {
  const unstamped: Record<string, string>[] = [
    {},
    { "x-forwarded-for": "203.0.113.9" },
    { [PEER_HEADER]: "203.0.113.9" },
    { [PEER_HEADER]: "00112233445566778899aabbccddeeff 203.0.113.9" },
  ];
  for (const sent of unstamped) {
    assert.equal(clientKey(new Headers(sent), null), UNKNOWN_CLIENT, JSON.stringify(sent));
  }
});

test("with a trusted-proxy header declared, the key is that header's right-most entry", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["x-forwarded-for", { "x-forwarded-for": "203.0.113.9" }, "203.0.113.9"],
    // A proxy that keeps the client's value appends the address it saw.
    ["x-forwarded-for", { "x-forwarded-for": "198.51.100.1, 198.51.100.2,203.0.113.9" }, "203.0.113.9"],
    ["x-real-ip", { "x-real-ip": " 203.0.113.9 ", "x-forwarded-for": "198.51.100.1" }, "203.0.113.9"],
  ];
  for (const [declared, sent, key] of cases) {
    assert.equal(clientKey(new Headers(sent), declared), key, JSON.stringify(sent));
  }
});

test("a declared header the request lacks falls back to the socket address", async () => {
  const headers = await headersReceivedOnLoopback({ "x-forwarded-for": "203.0.113.9" });
  assert.equal(clientKey(headers, "x-real-ip"), "127.0.0.1");
});

test("ATLAS_TRUSTED_PROXY_HEADER is read as a lowercase header name; blank or malformed values declare none", () => {
  const cases: [string | undefined, string | null][] = [
    [undefined, null],
    ["", null],
    ["   ", null],
    [" X-Real-IP ", "x-real-ip"],
    ["x-forwarded-for", "x-forwarded-for"],
    ["x real ip", null],
    ["x-forwarded-for:", null],
    ["x-forwarded-for,x-real-ip", null],
  ];
  for (const [value, header] of cases) {
    assert.equal(parseTrustedProxyHeader(value), header, JSON.stringify(value));
  }
});
