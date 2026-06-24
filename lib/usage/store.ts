import type Database from "better-sqlite3";
import type { ToolEvent, UsageCategory } from "@/lib/usage/types";

/** Row shape of the tool_events table (paramKeys stored as a JSON string). */
interface ToolEventRow {
  id: string;
  sessionId: string | null;
  ts: string | null;
  feature: string;
  category: string | null;
  project: string | null;
  howInvoked: string | null;
  paramKeys: string | null;
  cwd: string | null;
  gitBranch: string | null;
}

export function rowToEvent(r: ToolEventRow): ToolEvent {
  let keys: string[] = [];
  if (r.paramKeys) {
    try {
      const parsed = JSON.parse(r.paramKeys);
      if (Array.isArray(parsed)) keys = parsed.filter((k) => typeof k === "string");
    } catch {
      keys = [];
    }
  }
  return {
    id: r.id,
    sessionId: r.sessionId,
    ts: r.ts,
    feature: r.feature,
    category: (r.category as UsageCategory) ?? "other",
    project: r.project,
    howInvoked: r.howInvoked ?? "direct",
    paramKeys: keys,
    cwd: r.cwd,
    gitBranch: r.gitBranch,
  };
}

/** Load all mined tool events from the local DB (owner machine only). */
export function getToolEvents(db: Database.Database): ToolEvent[] {
  return (
    db.prepare("SELECT * FROM tool_events").all() as ToolEventRow[]
  ).map(rowToEvent);
}
