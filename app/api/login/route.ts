import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyPassword } from "@/lib/owner-auth/password";
import { signSession, sessionCookie } from "@/lib/owner-auth/session";
import { sameOriginUrl } from "@/lib/owner-auth/redirect";
import { rateLimit, recordFailure, clearAttempts } from "@/lib/owner-auth/ratelimit";

// scrypt needs the Node runtime (not edge).
export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

function backToLogin(req: NextRequest, error: string, retryAfterSec?: number): NextResponse {
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("error", error);
  const res = NextResponse.redirect(url, 303);
  if (retryAfterSec) res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Fail closed on misconfiguration.
  if (!process.env.OWNER_PASSWORD_HASH || !process.env.AUTH_SECRET) {
    return new NextResponse("Server misconfigured.", { status: 503 });
  }

  const ip = clientIp(req);
  const rl = rateLimit(ip);
  if (!rl.allowed) return backToLogin(req, "rate", rl.retryAfterSec);

  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  if (!verifyPassword(password, process.env.OWNER_PASSWORD_HASH)) {
    recordFailure(ip);
    return backToLogin(req, "bad");
  }

  clearAttempts(ip);
  const token = await signSession();
  // sameOriginUrl strips control/backslash chars AND re-checks the resolved
  // origin, so callbackUrl can never bounce the owner off-site.
  const dest = sameOriginUrl(form.get("callbackUrl"), req.nextUrl.origin);
  const res = NextResponse.redirect(dest, 303);
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
}
