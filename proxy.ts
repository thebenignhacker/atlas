import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { atlasMode, authControlsEnabled } from "@/lib/mode";
import { SESSION_COOKIE, verifySession } from "@/lib/owner-auth/session";

/**
 * Login surfaces and the owner-deployment gate (Next 16 `proxy` convention;
 * this file was `middleware.ts` before Next deprecated that name). No mode
 * except owner reads a session cookie here.
 *
 * Public and local modes have nothing to sign in to, so the login surfaces do
 * not exist there. /api/login and /api/logout answer 404 before a route runs,
 * without a look at the method: the routes export only POST, and the framework
 * answered GET, HEAD, PUT, DELETE and PATCH with 405 and OPTIONS with 204
 * itself. /login is rewritten to the not-found route, which renders on the
 * server inside the shell. Under next 16.2.7 the login page's notFound()
 * reached the browser as an empty document that only the client bundle fills
 * in, so the page's own check stays as a fallback, not as the answer.
 *
 * In owner mode every route requires a valid signed session cookie, except the
 * login surfaces (/login, /api/login, /api/logout). Verification uses Web Crypto
 * (edge-safe); the scrypt password check lives only in the Node-runtime login
 * route. Fails closed: without AUTH_SECRET or OWNER_PASSWORD_HASH the proxy
 * answers 503 before it looks at the path, so the login surfaces answer 503 too
 * (a missing secret must never read as "authenticated", and a sign-in form that
 * cannot succeed is not offered).
 *
 * In unified mode the proxy passes requests through: each render resolves its
 * own data mode from the session (lib/request-mode.ts).
 */
const LOGIN_PAGE = "/login";
const LOGIN_ROUTES = ["/api/login", "/api/logout"];

export async function proxy(req: NextRequest) {
  const mode = atlasMode();
  const { pathname, search } = req.nextUrl;

  if (!authControlsEnabled(mode)) {
    if (LOGIN_ROUTES.includes(pathname)) return new NextResponse(null, { status: 404 });
    if (pathname === LOGIN_PAGE) {
      const notFound = req.nextUrl.clone();
      notFound.pathname = "/_not-found";
      return NextResponse.rewrite(notFound);
    }
    return NextResponse.next();
  }
  if (mode !== "owner") return NextResponse.next();

  if (!process.env.AUTH_SECRET || !process.env.OWNER_PASSWORD_HASH) {
    // The visitor reads a neutral sentence; the variable names go to the log.
    console.error("atlas: owner mode serves nothing: AUTH_SECRET and OWNER_PASSWORD_HASH must both be set.");
    return new NextResponse("Sign-in is unavailable.", { status: 503 });
  }

  if (pathname === LOGIN_PAGE || LOGIN_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifySession(token))) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except static assets and image optimizer output.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
