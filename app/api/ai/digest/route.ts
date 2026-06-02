import { NextResponse } from "next/server";
import { aiAvailability } from "@/lib/ai/provider";
import { generateDigest } from "@/lib/ai/digest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const avail = aiAvailability();
  if (!avail.ok) {
    return NextResponse.json({ error: avail.reason }, { status: 409 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const result = await generateDigest(Boolean(body.force));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Digest failed" },
      { status: 500 }
    );
  }
}
