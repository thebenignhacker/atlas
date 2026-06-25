import { NextResponse } from "next/server";
import { atlasMode } from "@/lib/mode";
import {
  ROADMAP_STATUSES,
  updateRoadmapItem,
  type RoadmapStatus,
} from "@/lib/roadmap";

export const dynamic = "force-dynamic";

/**
 * POST /api/roadmap — update a roadmap item's status and/or append a comment.
 * Local mode only: the deployed snapshot modes run on a read-only filesystem,
 * and the roadmap source of truth (markdown files) lives on the owner machine.
 */
export async function POST(req: Request) {
  if (atlasMode() !== "local") {
    return NextResponse.json(
      { error: "Roadmap edits are only available in local mode." },
      { status: 403 }
    );
  }

  let payload: { id?: string; status?: string; comment?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { id, status, comment } = payload;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing item id." }, { status: 400 });
  }
  if (status && !ROADMAP_STATUSES.includes(status as RoadmapStatus)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  if (!status && !(comment && comment.trim())) {
    return NextResponse.json(
      { error: "Nothing to update: provide a status or a comment." },
      { status: 400 }
    );
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const item = updateRoadmapItem(id, {
      status: status as RoadmapStatus | undefined,
      comment,
      today,
    });
    if (!item) {
      return NextResponse.json({ error: "Unknown item id." }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to write roadmap file: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
