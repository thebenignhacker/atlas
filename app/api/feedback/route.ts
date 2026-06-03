import { NextResponse } from "next/server";
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
    const body = await req.json();
    if (!body.entityType || !body.entityId || !body.field || !body.correctedValue) {
      return NextResponse.json(
        { error: "entityType, entityId, field, correctedValue are required" },
        { status: 400 }
      );
    }
    recordFeedback({
      entityType: body.entityType,
      entityId: body.entityId,
      field: body.field,
      aiValue: body.aiValue ?? null,
      correctedValue: body.correctedValue,
      note: body.note ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Feedback failed" },
      { status: 500 }
    );
  }
}
