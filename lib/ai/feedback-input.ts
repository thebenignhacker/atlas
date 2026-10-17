import type { FeedbackInput } from "@/lib/ai/learning";

/**
 * The check POST /api/feedback runs on its body. Pure (no server-only import)
 * so it can be tested directly; the route answers 400 when this returns null
 * and records what it returns otherwise.
 *
 * correctedValue must be a string that is not empty after trimming. A blank
 * one is refused the same way as a missing one: once recorded, it reaches the
 * model through getLearningPreamble as a correction to respect.
 *
 * entityType, entityId and field must be non-empty strings; aiValue and note,
 * when sent, must each be a string or null. recordFeedback binds every one of
 * them to SQLite, which throws on an object, an array or a boolean; refused
 * here, such a value gets the route's 400 instead of a 500 carrying the
 * driver's message. A number is refused as well, as it is for correctedValue.
 */
export function parseFeedback(body: unknown): FeedbackInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { entityType, entityId, field, aiValue, correctedValue, note } = body as Record<
    string,
    unknown
  >;
  if (!isFilledString(entityType) || !isFilledString(entityId) || !isFilledString(field)) {
    return null;
  }
  if (typeof correctedValue !== "string" || !correctedValue.trim()) return null;
  if (!isOptionalString(aiValue) || !isOptionalString(note)) return null;
  return {
    entityType,
    entityId,
    field,
    aiValue: aiValue ?? null,
    correctedValue,
    note: note ?? null,
  };
}

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}
