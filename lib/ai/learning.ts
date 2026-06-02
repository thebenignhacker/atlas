import "server-only";
import { getDb } from "@/lib/db";

export interface FeedbackInput {
  entityType: string;
  entityId: string;
  field: string;
  aiValue?: string | null;
  correctedValue: string;
  note?: string | null;
}

export function recordFeedback(fb: FeedbackInput): void {
  getDb()
    .prepare(
      `INSERT INTO feedback (entityType, entityId, field, aiValue, correctedValue, note, createdAt)
       VALUES (@entityType, @entityId, @field, @aiValue, @correctedValue, @note, @createdAt)`
    )
    .run({
      entityType: fb.entityType,
      entityId: fb.entityId,
      field: fb.field,
      aiValue: fb.aiValue ?? null,
      correctedValue: fb.correctedValue,
      note: fb.note ?? null,
      createdAt: new Date().toISOString(),
    });
}

export interface LearnedItem {
  field: string;
  aiValue: string | null;
  correctedValue: string;
  note: string | null;
  entityId: string;
  createdAt: string;
}

export function getFeedback(limit = 200): LearnedItem[] {
  return getDb()
    .prepare(
      "SELECT field, aiValue, correctedValue, note, entityId, createdAt FROM feedback ORDER BY createdAt DESC LIMIT ?"
    )
    .all(limit) as LearnedItem[];
}

/**
 * The self-learning loop: distill past corrections into a prompt preamble so
 * future AI passes respect them. Fully local, transparent (visible in Settings),
 * and bounded — no model training.
 */
export function getLearningPreamble(): string {
  const items = getFeedback(40);
  if (items.length === 0) return "";
  const lines = items.map((i) => {
    const from = i.aiValue ? `was "${i.aiValue}", ` : "";
    const note = i.note ? ` (${i.note})` : "";
    return `- For ${i.entityId} ${i.field}: ${from}user corrected to "${i.correctedValue}"${note}`;
  });
  return [
    "The user has previously corrected your output. Respect these corrections and do not repeat the mistakes:",
    ...lines,
  ].join("\n");
}
