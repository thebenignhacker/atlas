import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/owner-auth/session";

/**
 * Owner-deployment gate. ONLY active when ATLAS_MODE=owner — public and local
 * deployments short-circuit immediately and never process session cookies.
 *
 * In owner mode every route requires a valid signed session cookie, except the
 * login surfaces (/login, /api/login, /api/logout). Verification uses Web Crypto
 * (edge-safe); the scrypt password check lives only in the Node-runtime login
 * route. Fails closed: without AUTH_SECRET or OWNER_PASSWORD_HASH, nothing is
 * served (a missing secret must never read as "authenticated").
 */
export async function middleware(req: NextRequest) {
  if (process.env.ATLAS_MODE !== "owner") return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login" || pathname === "/api/logout") {
    return NextResponse.next();
  }

  if (!process.env.AUTH_SECRET || !process.env.OWNER_PASSWORD_HASH) {
    return new NextResponse(
      "Server misconfigured: owner mode requires AUTH_SECRET and OWNER_PASSWORD_HASH.",
      { status: 503 }
    );
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
