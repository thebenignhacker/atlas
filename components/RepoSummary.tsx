"use client";

import { useState } from "react";
import { Sparkles, RefreshCw, Pencil, Check } from "lucide-react";
import { AiBadge } from "@/components/AiBadge";
import {
  summaryPresentation,
  type RepoSummaryRecord,
} from "@/lib/ai/summary-presentation";

export function RepoSummary({
  slug,
  available,
  eligible,
  eligibleReason,
  initial,
  lastCommitAt,
}: {
  slug: string;
  available: boolean;
  eligible: boolean;
  eligibleReason?: string | null;
  initial: RepoSummaryRecord | null;
  lastCommitAt: string | null;
}) {
  const [summary, setSummary] = useState<RepoSummaryRecord | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, force: Boolean(summary) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setSummary({ text: data.text, generatedAt: data.generatedAt ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveCorrection() {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "repo",
        entityId: slug,
        field: "summary",
        aiValue: summary?.text ?? null,
        correctedValue: draft,
        note: "user-edited summary",
      }),
    });
    setSummary({ text: draft, generatedAt: summary?.generatedAt ?? null });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!available || !eligible) {
    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface-1 p-4">
        <div className="flex items-center gap-2 text-sm text-faint">
          <Sparkles className="h-4 w-4 text-purple/60" />
          {!available
            ? "AI is off. Enable it in Settings for a generated summary."
            : eligibleReason}
        </div>
      </section>
    );
  }

  // An undated summary is treated as absent: it can only be regenerated.
  const view = summaryPresentation(summary, lastCommitAt);

  return (
    <section className="rounded-[var(--radius-card)] border border-purple/20 bg-surface-1 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <AiBadge label={view.show ? view.badge : undefined} />
        <div className="flex items-center gap-1.5">
          {view.show && !editing && (
            <button
              onClick={() => {
                setDraft(view.text);
                setEditing(true);
              }}
              title="Correct this, and Atlas will learn"
              className="rounded-md border border-line p-1.5 text-faint hover:text-text"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-purple/40 bg-purple/10 px-2.5 py-1.5 text-xs font-medium text-purple hover:bg-purple/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "…" : view.show ? "Regenerate" : "Generate"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-rose">{error}</p>}
      {saved && (
        <p className="mb-2 flex items-center gap-1 text-xs text-fresh">
          <Check className="h-3.5 w-3.5" /> Saved. Atlas will respect this next time.
        </p>
      )}

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-line bg-surface-2 p-2 text-sm text-text focus:border-purple focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={saveCorrection}
              className="rounded-md bg-purple px-3 py-1.5 text-xs font-medium text-white"
            >
              Save correction
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : view.show ? (
        <>
          <p className="text-sm leading-relaxed text-muted">{view.text}</p>
          {view.staleFlag && <p className="mt-2 text-xs text-faint">{view.staleFlag}</p>}
        </>
      ) : (
        <p className="text-sm text-faint">
          No summary yet. Generate one from the README, recent commits, and linked todos.
        </p>
      )}
    </section>
  );
}
