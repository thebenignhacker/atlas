import { randomBytes } from "node:crypto";
import { subscribe } from "node:diagnostics_channel";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

/**
 * The key the sign-in limiter (./ratelimit) counts failed attempts under.
 * NODE-ONLY: imported by the login route (runtime = "nodejs").
 *
 * A client can send any request header with any value, so a header is the key
 * only where the deployment declares that a proxy in front of it sets that
 * header on every request: ATLAS_TRUSTED_PROXY_HEADER names it, and is read
 * once, when this module loads. The key is the header's right-most
 * comma-separated entry, because a proxy that keeps the client's
 * x-forwarded-for value appends the address it saw after it.
 *
 * Without that setting the key is the TCP peer address of the connection. A
 * route handler is not given the socket, and `next start` fills
 * x-forwarded-for from the socket only when the request arrived without one.
 * So this module subscribes to Node's `http.server.request.start` diagnostics
 * channel, which Node's HTTP server publishes before it emits the request, and
 * writes the peer address into PEER_HEADER, replacing whatever the client sent
 * under that name. The written value starts with a random prefix chosen when
 * the subscription is made, so a request that arrived before this module
 * loaded, and was never stamped, is not read as carrying a peer address.
 *
 * A request with neither shares UNKNOWN_CLIENT with every other such request,
 * so the limit still engages for it.
 */

/** The request header the subscriber below writes the peer address into. */
export const PEER_HEADER = "x-atlas-peer-address";

/** The key shared by every request whose address could not be established. */
export const UNKNOWN_CLIENT = "unknown";

// The prefix lives on globalThis, so a second evaluation of this module (another
// bundle, a development reload) reuses it and does not subscribe again.
const PREFIX_SLOT = Symbol.for("atlas.owner-auth.peer-prefix");

function stampPrefix(): string {
  const slot = globalThis as typeof globalThis & { [PREFIX_SLOT]?: string };
  const existing = slot[PREFIX_SLOT];
  if (existing !== undefined) return existing;
  const prefix = `${randomBytes(16).toString("hex")} `;
  subscribe("http.server.request.start", (message) => {
    const { request, socket } = message as { request?: IncomingMessage; socket?: Socket };
    if (request) request.headers[PEER_HEADER] = `${prefix}${socket?.remoteAddress ?? ""}`;
  });
  slot[PREFIX_SLOT] = prefix;
  return prefix;
}

const PREFIX = stampPrefix();

// An HTTP field name (RFC 9110 token), lowercased.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/**
 * The header an ATLAS_TRUSTED_PROXY_HEADER value names, lowercased, or null
 * when the value is unset, blank or not a header name.
 */
export function parseTrustedProxyHeader(value: string | undefined): string | null {
  const name = value?.trim().toLowerCase();
  return name && HEADER_NAME.test(name) ? name : null;
}

const TRUSTED_PROXY_HEADER = parseTrustedProxyHeader(process.env.ATLAS_TRUSTED_PROXY_HEADER);
if (process.env.ATLAS_TRUSTED_PROXY_HEADER?.trim() && !TRUSTED_PROXY_HEADER) {
  console.error("atlas: ATLAS_TRUSTED_PROXY_HEADER is not a header name; the sign-in rate limit ignores it.");
}

/** The peer address the subscriber wrote for this request, or null. */
function peerAddress(headers: Headers): string | null {
  const stamp = headers.get(PEER_HEADER);
  if (!stamp?.startsWith(PREFIX)) return null;
  return stamp.slice(PREFIX.length) || null;
}

/**
 * The limiter key for a request: the right-most entry of the trusted-proxy
 * header when one is declared and the request carries it, else the socket
 * address, else UNKNOWN_CLIENT. `trustedHeader` defaults to the
 * ATLAS_TRUSTED_PROXY_HEADER value read when this module loaded.
 */
export function clientKey(
  headers: Headers,
  trustedHeader: string | null = TRUSTED_PROXY_HEADER
): string {
  if (trustedHeader) {
    const nearest = headers.get(trustedHeader)?.split(",").pop()?.trim();
    if (nearest) return nearest;
  }
  return peerAddress(headers) ?? UNKNOWN_CLIENT;
}
