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

// The page the owner asked for rides along, so the next attempt still lands
// there. `callbackUrl` has already been through sameOriginPath; "/" is the
// login page's own default and is left out.
function backToLogin(error: string, callbackUrl: string, retryAfterSec?: number): NextResponse {
  const params = new URLSearchParams({ error });
  if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
  const res = seeOther(`/login?${params}`);
  if (retryAfterSec) res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // No sign-in in public and local modes. proxy.ts answers 404 there before a
  // route runs, whatever the method asked; this repeats the check for POST, the
  // one method the route serves.
  if (!authControlsEnabled(atlasMode())) return new NextResponse(null, { status: 404 });

  // Fail closed on a missing secret. The visitor reads a neutral sentence; the
  // variable names go to the server log, never their values.
  if (!process.env.OWNER_PASSWORD_HASH || !process.env.AUTH_SECRET) {
    console.error("atlas: sign-in is unavailable: AUTH_SECRET and OWNER_PASSWORD_HASH must both be set.");
    return new NextResponse("Sign-in is unavailable.", { status: 503 });
  }

  // req.formData() rejects with a TypeError when the body is not form data:
  // text/plain, application/json, no Content-Type, or multipart that does not
  // parse. With no form there is no password to check, so the attempt is
  // answered below as a failed sign-in, after the rate-limit check like any
  // other (test/auth/login-body.test.ts).
  const form = await req.formData().catch(() => null);
  // sameOriginPath strips control/backslash chars, re-checks the resolved
  // origin and turns a path that starts with "//" into "/"; the off-site
  // callbackUrl payloads in test/auth/redirect.test.ts all land on "/".
  const callbackUrl = sameOriginPath(form?.get("callbackUrl"));

  // The socket address, or a platform header the deployment declares; never a
  // header the client chooses (lib/owner-auth/client-key.ts).
  const key = clientKey(req.headers);
  const rl = rateLimit(key);
  if (!rl.allowed) return backToLogin("rate", callbackUrl, rl.retryAfterSec);

  const password = String(form?.get("password") ?? "");

  if (!form || !verifyPassword(password, process.env.OWNER_PASSWORD_HASH)) {
    recordFailure(key);
    return backToLogin("bad", callbackUrl);
  }

  clearAttempts(key);
  const token = await signSession();
  const res = seeOther(callbackUrl);
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
}
