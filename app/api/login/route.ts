import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyPassword } from "@/lib/owner-auth/password";
import { signSession, sessionCookie } from "@/lib/owner-auth/session";
import { sameOriginPath } from "@/lib/owner-auth/redirect";
import { seeOther } from "@/lib/owner-auth/see-other";
import { rateLimit, recordFailure, clearAttempts } from "@/lib/owner-auth/ratelimit";

// scrypt needs the Node runtime (not edge).
export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

function backToLogin(error: string, retryAfterSec?: number): NextResponse {
  const res = seeOther(`/login?${new URLSearchParams({ error })}`);
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
  if (!rl.allowed) return backToLogin("rate", rl.retryAfterSec);

  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  if (!verifyPassword(password, process.env.OWNER_PASSWORD_HASH)) {
    recordFailure(ip);
    return backToLogin("bad");
  }

  clearAttempts(ip);
  const token = await signSession();
  // sameOriginPath strips control/backslash chars, re-checks the resolved
  // origin and turns a path that starts with "//" into "/"; the off-site
  // callbackUrl payloads in test/auth/redirect.test.ts all land on "/".
  const res = seeOther(sameOriginPath(form.get("callbackUrl")));
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
}
