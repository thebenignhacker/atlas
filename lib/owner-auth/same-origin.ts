/**
 * Whether a state-changing request came from this deployment, for the sign-out
 * route.
 *
 * The session cookie is SameSite=Strict (./session.ts), so a form another site
 * submits carries no cookie. Sign-out needs none: its answer clears the cookie,
 * and a browser can apply that header in the answer to a top-level form
 * submission from another site as well. So the route reads what the browser says
 * about where the request came from, and accepts it when either holds:
 *
 *  - Sec-Fetch-Site is "same-origin" (a page of this origin sent it) or "none"
 *    (the person started it);
 *  - Origin equals this deployment's own origin, which covers a browser that
 *    sends no Sec-Fetch-Site. Origin "null" never matches.
 *
 * Everything else is refused: Sec-Fetch-Site "cross-site" or "same-site"
 * (another origin on the same site) without a matching Origin, an Origin that
 * names another origin, and a request that carries neither header.
 *
 * The own origin is built from the headers that carry the host the browser
 * asked for: the first x-forwarded-host value, else host, with the first
 * x-forwarded-proto value. Next's server fills in x-forwarded-host and
 * x-forwarded-proto when no proxy set them. req.nextUrl fills in only what those
 * headers leave out: under `next start -H 127.0.0.1` it reads localhost, not the
 * host the browser used (./see-other.ts). Another site's form cannot choose any
 * of these header values.
 */

function firstValue(header: string | null): string | null {
  const first = header?.split(",")[0]?.trim();
  return first ? first : null;
}

/**
 * This deployment's origin as the browser addressed it; null when the scheme is
 * not http or https, or the host does not parse.
 */
function ownOrigin(headers: Headers, url: URL): string | null {
  const host = firstValue(headers.get("x-forwarded-host")) ?? (headers.get("host") || url.host);
  const scheme = (firstValue(headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "")).toLowerCase();
  // Pages load over http or https. A scheme such as javascript or data
  // serializes to the opaque origin "null", which must never match the Origin
  // "null" that a sandboxed frame or a cross-origin redirect sends.
  if (scheme !== "http" && scheme !== "https") return null;
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return null;
  }
}

/** True when Sec-Fetch-Site is "same-origin" or "none", or Origin equals ownOrigin(). */
export function fromOwnOrigin(headers: Headers, url: URL): boolean {
  const site = headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return true;
  const origin = headers.get("origin");
  if (origin === null || origin === "null") return false;
  return origin === ownOrigin(headers, url);
}
