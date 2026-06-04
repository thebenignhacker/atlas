"use client";

import { useMemo, useState } from "react";
import { Check, Copy, GitBranch, History, ScrollText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ContextCard, Session } from "@/lib/types";

function ago(iso: string | null): string {
  if (!iso) return "unknown";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function SessionsView({
  sessions,
  cards,
}: {
  sessions: Session[];
  cards: ContextCard[];
}) {
  // Cards each session established, grouped by originSessionId.
  const cardsBySession = useMemo(() => {
    const m = new Map<string, ContextCard[]>();
    for (const c of cards) {
      if (!c.originSessionId) continue;
      const list = m.get(c.originSessionId) ?? [];
      list.push(c);
      m.set(c.originSessionId, list);
    }
    return m;
  }, [cards]);

  if (sessions.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
        No sessions recorded yet. The SessionStart hook registers each Claude session;
        cards you write with{" "}
        <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-muted">
          atlas-context add
        </code>{" "}
        get attributed to it automatically.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {sessions.map((s) => (
        <SessionCard
          key={s.id}
          session={s}
          established={cardsBySession.get(s.id) ?? []}
        />
      ))}
    </div>
  );
}

function SessionCard({
  session,
  established,
}: {
  session: Session;
  established: ContextCard[];
}) {
  return (
    <div
      // Anchor target so a card's "established by session X" link scrolls here.
      id={session.id}
      className="atlas-fade scroll-mt-20 rounded-[var(--radius-card)] border border-line bg-surface-1 px-4 py-3.5 transition-colors hover:border-line-strong"
    >
      <div className="flex flex-wrap items-center gap-2">
        <History className="h-3.5 w-3.5 text-faint" />
        <span className="font-mono text-sm font-medium text-text">
          {session.id.slice(0, 8)}
        </span>
        <span className="text-[11px] text-faint">started {ago(session.startedAt)}</span>
        <span className="ml-auto rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted">
          {session.cardCount} card{session.cardCount === 1 ? "" : "s"}
        </span>
      </div>

      {session.summary && (
        <p className="mt-2 text-sm leading-relaxed text-text">{session.summary}</p>
      )}

      {(session.repos.length > 0 || session.branches.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
          {session.repos.map((r) => (
            <span key={`r-${r}`} className="text-muted">
              {r}
            </span>
          ))}
          {session.branches.map((b) => (
            <span key={`b-${b}`} className="inline-flex items-center gap-1 text-faint">
              <GitBranch className="h-3 w-3" />
              {b}
            </span>
          ))}
        </div>
      )}

      {established.length > 0 && (
        <div className="mt-2.5 space-y-1 border-t border-line pt-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">
            <ScrollText className="h-3 w-3" />
            established
          </div>
          {established.map((c) => (
            <div key={c.id} className="text-[12px] text-muted">
              <span className="font-medium text-text">{c.subject}</span>{" "}
              <span className="text-faint">· {c.project}</span>
            </div>
          ))}
        </div>
      )}

      <ResumeRow id={session.id} />
    </div>
  );
}

/** Copyable command to re-open this Claude session locally. */
function ResumeRow({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const value = `claude --resume ${id}`;
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
        resume
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
