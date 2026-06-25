import "server-only";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { isOwnerMode, type ResolvedMode } from "@/lib/mode";
import { loadOwnerSnapshot } from "@/lib/snapshot";

export const hashContent = (s: string) =>
  crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

export interface CachedOutput {
  output: string;
  model: string;
  generatedAt: string;
  promptTokens: number;
  completionTokens: number;
  cached: true;
}

function cacheId(entityType: string, entityId: string, task: string): string {
  return `${entityType}:${entityId}:${task}`;
}

/** Return a cached AI output only if the content hash still matches. */
export function getCached(
  entityType: string,
  entityId: string,
  task: string,
  contentHash: string
): CachedOutput | null {
  const row = getDb()
    .prepare(
      "SELECT output, model, generatedAt, promptTokens, completionTokens FROM ai_outputs WHERE id = ? AND contentHash = ?"
    )
    .get(cacheId(entityType, entityId, task), contentHash) as
    | Omit<CachedOutput, "cached">
    | undefined;
  return row ? { ...row, cached: true } : null;
}

export function saveOutput(args: {
  entityType: string;
  entityId: string;
  task: string;
  contentHash: string;
  model: string;
  output: string;
  promptTokens: number;
  completionTokens: number;
}): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO ai_outputs
       (id, entityType, entityId, task, contentHash, model, output, promptTokens, completionTokens, generatedAt)
       VALUES (@id, @entityType, @entityId, @task, @contentHash, @model, @output, @promptTokens, @completionTokens, @generatedAt)`
    )
    .run({
      id: cacheId(args.entityType, args.entityId, args.task),
      ...args,
      generatedAt: new Date().toISOString(),
    });
}

/** Latest output for an entity/task regardless of content hash (for display). */
export function getLatestOutput(
  entityType: string,
  entityId: string,
  task: string
): { output: string; model: string; generatedAt: string } | null {
  const row = getDb()
    .prepare(
      "SELECT output, model, generatedAt FROM ai_outputs WHERE entityType = ? AND entityId = ? AND task = ?"
    )
    .get(entityType, entityId, task) as
    | { output: string; model: string; generatedAt: string }
    | undefined;
  return row ?? null;
}

export interface AICostSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export function getCostSummary(mode?: ResolvedMode): AICostSummary {
  if (mode ? mode === "owner" : isOwnerMode()) return loadOwnerSnapshot().cost;
  const row = getDb()
    .prepare(
      "SELECT count(*) calls, COALESCE(SUM(promptTokens),0) promptTokens, COALESCE(SUM(completionTokens),0) completionTokens FROM ai_outputs"
    )
    .get() as AICostSummary;
  return row;
}
