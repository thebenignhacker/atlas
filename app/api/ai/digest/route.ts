import { NextResponse } from "next/server";
import { aiAvailability } from "@/lib/ai/provider";
import { generateDigest } from "@/lib/ai/digest";
import { isSnapshotMode } from "@/lib/mode";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (isSnapshotMode()) {
    // Deployed (public/owner) hosts have no writable DB -- generation is local-only.
    return NextResponse.json(
      { error: "Generation runs locally; this deployment is read-only." },
      { status: 403 }
    );
  }
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
