import type { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/owner-auth/session";
import { seeOther } from "@/lib/owner-auth/see-other";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const res = seeOther("/login");
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
