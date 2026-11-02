import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { atlasMode, authControlsEnabled } from "@/lib/mode";
import { clearSessionCookie } from "@/lib/owner-auth/session";
import { fromOwnOrigin } from "@/lib/owner-auth/same-origin";
import { seeOther } from "@/lib/owner-auth/see-other";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // No session cookie can exist in public and local modes: nothing to clear.
  if (!authControlsEnabled(atlasMode())) return new NextResponse(null, { status: 404 });
  // The answer clears the session cookie, and a browser can apply that header in
  // the answer to another site's form too, so only this deployment may ask
  // (lib/owner-auth/same-origin.ts).
  if (!fromOwnOrigin(req.headers, req.nextUrl)) {
    return new NextResponse("Sign-out refused: the request did not show that it came from this site.", {
      status: 403,
    });
  }
  const res = seeOther("/login");
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
