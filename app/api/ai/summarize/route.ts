import { NextResponse } from "next/server";
import { aiAvailability } from "@/lib/ai/provider";
import { summarizeRepo } from "@/lib/ai/summarize";
import { isPublicMode } from "@/lib/queries";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (isPublicMode()) {
    return NextResponse.json({ error: "Not available in public demo" }, { status: 403 });
  }
  const avail = aiAvailability();
  if (!avail.ok) {
    return NextResponse.json({ error: avail.reason }, { status: 409 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }
    const result = await summarizeRepo(body.slug, Boolean(body.force));
    if (result.blocked) {
      return NextResponse.json({ error: result.blocked }, { status: 403 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Summarize failed" },
      { status: 500 }
    );
  }
}
