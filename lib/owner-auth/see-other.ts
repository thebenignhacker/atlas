import { NextResponse } from "next/server";

/**
 * A 303 See Other with a relative Location, for the login and logout routes.
 *
 * NextResponse.redirect needs an absolute URL, and the origin a route handler
 * sees in req.nextUrl is not the one the browser used: under
 * `next start -H 127.0.0.1` it reads http://localhost:<port>. A redirect built
 * from it moves the browser to localhost, where the session cookie just set for
 * 127.0.0.1 is not sent. A relative Location resolves against the URL the
 * browser requested, so it stays on that host. `path` must already be a
 * same-origin path (sameOriginPath in ./redirect.ts).
 */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
