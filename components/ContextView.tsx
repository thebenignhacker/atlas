"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, FileCode2, Lock, ShieldAlert, History } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ContextCard, Freshness } from "@/lib/types";

const PILL: Record<Freshness, { label: string; cls: string }> = {
  fresh: { label: "fresh", cls: "bg-fresh/12 text-fresh" },
  drifted: { label: "drifted", cls: "bg-amber/12 text-amber" },
  expired: { label: "expired", cls: "bg-amber/12 text-amber" },
  stale: { label: "stale", cls: "bg-rose/12 text-rose" },
  unverified: { label: "unverified", cls: "bg-faint/12 text-faint" },
};

const RANK: Record<Freshness, number> = {
  drifted: 0,
  stale: 0,
  expired: 1,
  unverified: 2,
  fresh: 3,
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}
function base(p: string): string {
  return p.split("/").pop() || p;
}

export function ContextView({ cards }: { cards: ContextCard[] }) {
  const [project, setProject] = useState("all");
  const [fresh, setFresh] = useState<"all" | "flagged" | "fresh">("all");

  const projects = useMemo(
    () => Array.from(new Set(cards.map((c) => c.project))).sort(),
    [cards]
  );

  const filtered = useMemo(() => {
    return cards
      .filter((c) => project === "all" || c.project === project)
      .filter((c) =>
        fresh === "all"
          ? true
          : fresh === "fresh"
            ? c.freshness === "fresh"
            : c.freshness !== "fresh"
      )
      .sort(
        (a, b) =>
          RANK[a.freshness] - RANK[b.freshness] ||
          a.project.localeCompare(b.project) ||
          a.subject.localeCompare(b.subject)
      );
  }, [cards, project, fresh]);

  const flaggedCount = cards.filter((c) => c.freshness !== "fresh").length;

  if (cards.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
        No context cards yet. Write one with{" "}
        <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-muted">
          atlas-context add
        </code>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={project} onChange={setProject}>
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={fresh} onChange={(v) => setFresh(v as typeof fresh)}>
          <option value="all">All states</option>
          <option value="flagged">Needs re-verification</option>
          <option value="fresh">Fresh only</option>
        </Select>
        {flaggedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs font-medium text-amber">
            <ShieldAlert className="h-3.5 w-3.5" />
            {flaggedCount} need re-verification
          </span>
        )}
        <span className="ml-auto text-xs text-faint">
          {filtered.length} of {cards.length} cards
        </span>
      </div>

      <div className="space-y-2.5">
        {filtered.map((c) => (
          <Card key={c.id} card={c} />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line py-12 text-center text-sm text-faint">
            No cards match these filters.
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ card }: { card: ContextCard }) {
  const pill = PILL[card.freshness];
  const flagged = card.freshness !== "fresh";
  const reVerify = card.verifyCommand ?? `atlas-context verify ${card.id}`;

  return (
    <div
      className={[
        "atlas-fade rounded-[var(--radius-card)] border bg-surface-1 px-4 py-3.5 transition-colors",
        flagged ? "border-amber/30" : "border-line hover:border-line-strong",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}
        >
          {pill.label}
        </span>
        {card.sensitive && (
          <span
            className="inline-flex items-center gap-1 rounded bg-clay/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-clay"
            title="Never published — excluded from every public surface"
          >
            <Lock className="h-3 w-3" />
            sensitive
          </span>
        )}
        <span className="text-sm font-medium text-text">{card.subject}</span>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {card.project}
        </span>
        {card.tags.map((t) => (
          <span key={t} className="text-[11px] text-faint">
            #{t}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-faint">
          verified {ago(card.lastVerifiedAt)}
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-text">{card.claim}</p>
      {card.detail && (
        <p className="mt-1 text-[12px] leading-relaxed text-muted">{card.detail}</p>
      )}

      {card.provenance.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          <FileCode2 className="h-3.5 w-3.5" />
          {card.provenance.map((p) => (
            <span
              key={p.path}
              className={
                card.driftedPaths.includes(p.path) ? "text-amber" : "text-muted"
              }
            >
              {base(p.path)}
              {card.driftedPaths.includes(p.path) && " (changed)"}
            </span>
          ))}
        </div>
      )}

      {card.originSessionId && (
        <Link
          href={`/sessions#${card.originSessionId}`}
          className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-faint transition-colors hover:text-teal"
          title="Jump to the Claude session that established this fact"
        >
          <History className="h-3 w-3" />
          established by session {card.originSessionId.slice(0, 8)}
        </Link>
      )}

      {flagged && <CopyRow label="re-verify" value={reVerify} />}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="mt-2.5 flex w-full items-center gap-2 rounded-md border border-line bg-surface-2/60 px-2.5 py-1.5 text-left font-mono text-[11px] text-muted transition-colors hover:border-line-strong hover:text-text"
      title="Copy to clipboard"
    >
      <span className="shrink-0 font-sans text-[10px] font-medium uppercase tracking-wide text-teal">
        {label}
      </span>
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-fresh" />
      ) : (
        <Copy className="ml-auto h-3.5 w-3.5 shrink-0 text-faint" />
      )}
    </button>
  );
}

function Select<T extends string>({
  value,
  onChange,
  children,
}: {
  value: T;
  onChange: (v: T) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-muted focus:border-teal focus:outline-none"
    >
      {children}
    </select>
  );
}
