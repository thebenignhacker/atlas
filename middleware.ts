import { NextResponse } from "next/server";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

/**
 * Owner-deployment gate. ONLY active when ATLAS_MODE=owner -- public and local
 * deployments short-circuit before any auth machinery loads, so they never need
 * AUTH_SECRET / GitHub credentials and never process session cookies.
 *
 * In owner mode every route requires a session except the Auth.js endpoints
 * (/api/auth/*). Unauthenticated requests are redirected to the GitHub sign-in
 * flow. The single-owner allowlist is enforced in the signIn callback (auth.ts);
 * reaching here with a session means GitHub already vouched for the owner.
 *
 * NextAuth is loaded lazily and used via its wrapper form (which populates
 * `req.auth` from the request cookies -- the no-arg `auth()` relies on
 * next/headers and does not work in middleware).
 */
export async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (process.env.ATLAS_MODE !== "owner") return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  // Auth.js endpoints must stay reachable for the sign-in flow.
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Fail closed: owner mode REQUIRES a signing secret. Without AUTH_SECRET,
  // NextAuth cannot validate sessions and its session endpoint returns a truthy
  // error object ({ message }) -- which a naive `!req.auth` check mistakes for a
  // valid session, leaking full data. Refuse to serve anything in this state.
  if (!process.env.AUTH_SECRET) {
    return new NextResponse(
      "Server misconfigured: owner mode requires AUTH_SECRET.",
      { status: 503 }
    );
  }

  const { auth } = await import("@/auth");
  // auth() is overloaded for both route handlers and middleware; cast to the
  // middleware form so it accepts (request, event).
  const gate = auth((authedReq) => {
    // Require a session-SHAPED object: a genuine session has `.user`. NextAuth
    // returns null when unauthenticated, but a config error returns a truthy
    // { message } object -- only `.user` distinguishes a real session, so checking
    // truthiness alone would fail open.
    if (!authedReq.auth?.user) {
      const signInUrl = new URL("/api/auth/signin", authedReq.nextUrl.origin);
      signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }) as unknown as NextMiddleware;
  return gate(req, event);
}

export const config = {
  // Run on everything except static assets and image optimizer output.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
