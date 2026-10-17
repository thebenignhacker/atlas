import type { FeedbackInput } from "@/lib/ai/learning";

/**
 * The check POST /api/feedback runs on its body. Pure (no server-only import)
 * so it can be tested directly; the route answers 400 when this returns null
 * and records what it returns otherwise.
 *
 * correctedValue must be a string that is not empty after trimming. A blank
 * one is refused the same way as a missing one: once recorded, it reaches the
 * model through getLearningPreamble as a correction to respect. Only
 * correctedValue is type-checked; the other fields pass through as sent.
 */
export function parseFeedback(body: unknown): FeedbackInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { entityType, entityId, field, aiValue, correctedValue, note } = body as Record<
    string,
    unknown
  >;
  if (!entityType || !entityId || !field) return null;
  if (typeof correctedValue !== "string" || !correctedValue.trim()) return null;
  return {
    entityType: entityType as string,
    entityId: entityId as string,
    field: field as string,
    aiValue: (aiValue ?? null) as string | null,
    correctedValue,
    note: (note ?? null) as string | null,
  };
}
