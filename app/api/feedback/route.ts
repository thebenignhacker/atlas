import { NextResponse } from "next/server";
import { parseFeedback } from "@/lib/ai/feedback-input";
import { recordFeedback } from "@/lib/ai/learning";
import { isSnapshotMode } from "@/lib/mode";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (isSnapshotMode()) {
    // Deployed (public/owner) hosts have no writable DB -- feedback is local-only.
    return NextResponse.json(
      { error: "Not available on this deployment; record feedback locally." },
      { status: 403 }
    );
  }
  try {
    const input = parseFeedback(await req.json());
    if (!input) {
      return NextResponse.json(
        { error: "entityType, entityId, field, correctedValue are required" },
        { status: 400 }
      );
    }
    recordFeedback(input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Feedback failed" },
      { status: 500 }
    );
  }
}
