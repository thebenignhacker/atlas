import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { atlasMode, authControlsEnabled } from "@/lib/mode";
import { verifyPassword } from "@/lib/owner-auth/password";
import { signSession, sessionCookie } from "@/lib/owner-auth/session";
import { sameOriginPath } from "@/lib/owner-auth/redirect";
import { seeOther } from "@/lib/owner-auth/see-other";
import { rateLimit, recordFailure, clearAttempts } from "@/lib/owner-auth/ratelimit";
import { clientKey } from "@/lib/owner-auth/client-key";

// scrypt and the client-key subscription need the Node runtime (not edge).
export const runtime = "nodejs";

function backToLogin(error: string, retryAfterSec?: number): NextResponse {
  const res = seeOther(`/login?${new URLSearchParams({ error })}`);
  if (retryAfterSec) res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // No sign-in in public and local modes: the route does not exist there.
  if (!authControlsEnabled(atlasMode())) return new NextResponse(null, { status: 404 });

  // Fail closed on a missing secret. The visitor reads a neutral sentence; the
  // variable names go to the server log, never their values.
  if (!process.env.OWNER_PASSWORD_HASH || !process.env.AUTH_SECRET) {
    console.error("atlas: sign-in is unavailable: AUTH_SECRET and OWNER_PASSWORD_HASH must both be set.");
    return new NextResponse("Sign-in is unavailable.", { status: 503 });
  }

  // The socket address, or a platform header the deployment declares; never a
  // header the client chooses (lib/owner-auth/client-key.ts).
  const key = clientKey(req.headers);
  const rl = rateLimit(key);
  if (!rl.allowed) return backToLogin("rate", rl.retryAfterSec);

  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  if (!verifyPassword(password, process.env.OWNER_PASSWORD_HASH)) {
    recordFailure(key);
    return backToLogin("bad");
  }

  clearAttempts(key);
  const token = await signSession();
  // sameOriginPath strips control/backslash chars, re-checks the resolved
  // origin and turns a path that starts with "//" into "/"; the off-site
  // callbackUrl payloads in test/auth/redirect.test.ts all land on "/".
  const res = seeOther(sameOriginPath(form.get("callbackUrl")));
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
}
