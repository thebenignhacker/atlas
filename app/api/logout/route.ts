import { NextResponse } from "next/server";
import { atlasMode, authControlsEnabled } from "@/lib/mode";
import { clearSessionCookie } from "@/lib/owner-auth/session";
import { seeOther } from "@/lib/owner-auth/see-other";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  // No session cookie can exist in public and local modes: nothing to clear.
  if (!authControlsEnabled(atlasMode())) return new NextResponse(null, { status: 404 });
  const res = seeOther("/login");
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
