import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/owner-auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.redirect(new URL("/login", req.nextUrl.origin), 303);
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
