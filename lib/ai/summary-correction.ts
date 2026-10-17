/**
 * Saving a user's correction to a repo summary. Pure (no server-only import)
 * so the interactive client block and the tests share one rule: only a 2xx
 * answer from /api/feedback is a save. Any other answer, and a request that
 * never reached the server, comes back as the reason it was not saved, so the
 * panel can keep the draft open and show why.
 */

export interface SummaryCorrection {
  slug: string;
  /** The summary text the user corrected, if one was shown. */
  aiValue: string | null;
  correctedValue: string;
}

export type CorrectionSave = { ok: true } | { ok: false; error: string };

/** A draft that is empty or only whitespace has nothing to save; the route answers an empty one with a 400. */
export function canSaveCorrection(draft: string): boolean {
  return draft.trim().length > 0;
}

/** The route's own `error` text, or the status when the body carries none (a proxy's error page, say). */
async function refusalOf(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.error === "string" && data.error) return data.error;
  } catch {
    // Not JSON: fall through to the status.
  }
  return `the server answered HTTP ${res.status}`;
}

export async function saveSummaryCorrection(
  correction: SummaryCorrection,
  fetchImpl: typeof fetch = fetch
): Promise<CorrectionSave> {
  let res: Response;
  try {
    res = await fetchImpl("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "repo",
        entityId: correction.slug,
        field: "summary",
        aiValue: correction.aiValue,
        correctedValue: correction.correctedValue,
        note: "user-edited summary",
      }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "the request failed" };
  }
  if (res.ok) return { ok: true };
  return { ok: false, error: await refusalOf(res) };
}
