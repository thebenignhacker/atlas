"use client";

import { useState } from "react";
import { Sparkles, RefreshCw, ShieldCheck } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { AiBadge } from "@/components/AiBadge";
import { relativeTime } from "@/lib/util/date";

interface Digest {
  text: string;
  model?: string;
  generatedAt: string;
  promptTokens?: number;
  completionTokens?: number;
  cached: boolean;
  reposIncluded: number;
  reposExcluded: number;
}

export function DigestView({
  available,
  reason,
  initial,
  readOnly = false,
}: {
  available: boolean;
  reason?: string;
  initial: Digest | null;
  /** Owner deployment: the host can't regenerate (read-only filesystem). Show
   *  the cached digest without a Generate button. */
  readOnly?: boolean;
}) {
  const [digest, setDigest] = useState<Digest | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setDigest(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (!available) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface-1 p-6">
        <div className="flex items-center gap-2 text-text">
          <Sparkles className="h-5 w-5 text-purple" />
          <h2 className="font-semibold">AI is off</h2>
        </div>
        <p className="mt-2 text-sm text-muted">{reason}</p>
        <p className="mt-4 text-sm text-muted">
          Atlas works fully without AI. To enable the digest, set{" "}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-teal">
            ai.enabled = true
          </code>{" "}
          in <code className="font-mono text-teal">atlas.config.json</code> and provide
          an API key. See Settings for what gets sent.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-faint">
          <ShieldCheck className="h-3.5 w-3.5 text-teal" />
          {digest
            ? `${digest.reposIncluded} repos in scope · ${digest.reposExcluded} excluded by privacy policy`
            : "Ready to generate"}
        </div>
        {readOnly ? (
          <span className="text-[11px] text-faint">
            Remote view; regenerate locally with{" "}
            <code className="font-mono text-teal">npm run dev</code>
          </span>
        ) : (
          <button
            onClick={() => generate(Boolean(digest))}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-purple/40 bg-purple/10 px-3 py-2 text-sm font-medium text-purple transition-colors hover:bg-purple/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Thinking…" : digest ? "Regenerate" : "Generate digest"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-rose">
          {error}
        </div>
      )}

      {digest ? (
        <article className="rounded-[var(--radius-card)] border border-purple/20 bg-surface-1 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <AiBadge />
            <span className="text-[11px] text-faint">
              {digest.model} · {digest.cached ? "cached" : "fresh"} ·{" "}
              {relativeTime(digest.generatedAt)}
              {digest.completionTokens
                ? ` · ${digest.promptTokens ?? 0}→${digest.completionTokens} tokens`
                : ""}
            </span>
          </div>
          <Markdown text={digest.text} />
        </article>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
          {readOnly
            ? "No digest in this snapshot yet. Generate one locally, then re-publish the owner snapshot."
            : "No digest yet. Generate one to see what moved, what's stale, and what to focus on next."}
        </div>
      )}
    </div>
  );
}
