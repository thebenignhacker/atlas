"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Lock,
  MessageSquarePlus,
  Code2,
  FileText,
} from "lucide-react";
import {
  ROADMAP_STATUSES,
  type RoadmapItem,
  type RoadmapStatus,
} from "@/lib/roadmap-shared";
import { PRIORITY } from "@/lib/display";

const STATUS_META: Record<
  RoadmapStatus,
  { label: string; dot: string; text: string; chip: string }
> = {
  blocked: { label: "Blocked", dot: "bg-dormant", text: "text-dormant", chip: "bg-dormant/15 text-dormant" },
  ready: { label: "Ready", dot: "bg-teal", text: "text-teal", chip: "bg-teal/15 text-teal" },
  "in-progress": { label: "In progress", dot: "bg-marigold", text: "text-amber", chip: "bg-amber/15 text-amber" },
  "in-review": { label: "In review", dot: "bg-purple", text: "text-purple", chip: "bg-purple/15 text-purple" },
  done: { label: "Done", dot: "bg-fresh", text: "text-fresh", chip: "bg-fresh/15 text-fresh" },
};

export function RoadmapBoard({ items }: { items: RoadmapItem[] }) {
  const [group, setGroup] = useState<"status" | "area">("status");
  const [area, setArea] = useState("all");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const byId = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i])),
    [items]
  );
  const areas = useMemo(
    () => Array.from(new Set(items.map((i) => i.area))).sort(),
    [items]
  );

  const visible = area === "all" ? items : items.filter((i) => i.area === area);

  async function mutate(id: string, body: { status?: RoadmapStatus; comment?: string }) {
    const res = await fetch("/api/roadmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Request failed" }));
      alert(`Could not update: ${error}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  const card = (item: RoadmapItem) => (
    <RoadmapCard key={item.id} item={item} byId={byId} pending={pending} onMutate={mutate} />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {(["status", "area"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              className={[
                "px-3 py-1.5 text-sm capitalize transition-colors",
                group === g ? "bg-surface-2 text-text" : "bg-surface-1 text-muted hover:text-text",
              ].join(" ")}
            >
              By {g}
            </button>
          ))}
        </div>
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm text-text focus:border-teal focus:outline-none"
        >
          <option value="all">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {pending && <span className="text-xs text-faint">saving…</span>}
      </div>

      {group === "status" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          {ROADMAP_STATUSES.map((s) => {
            const col = visible.filter((i) => i.status === s);
            const meta = STATUS_META[s];
            return (
              <div key={s} className="min-w-0">
                <div className="mb-2 flex items-center gap-2 px-0.5">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className={`text-xs font-semibold uppercase tracking-wide ${meta.text}`}>
                    {meta.label}
                  </span>
                  <span className="text-xs text-faint">{col.length}</span>
                </div>
                <div className="space-y-3">
                  {col.length === 0 && (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-line py-6 text-center text-xs text-faint">
                      —
                    </div>
                  )}
                  {col.map(card)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-7">
          {areas
            .filter((a) => area === "all" || a === area)
            .map((a) => {
              const group = visible.filter((i) => i.area === a);
              if (group.length === 0) return null;
              return (
                <div key={a}>
                  <h2 className="mb-3 flex items-center gap-2 border-b border-line pb-2 font-display text-lg font-semibold text-text">
                    {a}
                    <span className="text-sm font-normal text-faint">{group.length}</span>
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.map(card)}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function RoadmapCard({
  item,
  byId,
  pending,
  onMutate,
}: {
  item: RoadmapItem;
  byId: Record<string, RoadmapItem>;
  pending: boolean;
  onMutate: (id: string, body: { status?: RoadmapStatus; comment?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const meta = STATUS_META[item.status];
  const pr = item.priority ? PRIORITY[item.priority] : null;

  // A dependency is satisfied when the item it points to is done.
  const deps = item.dependsOn.map((id) => byId[id]).filter(Boolean);
  const unmet = deps.filter((d) => d.status !== "done");
  const canStart = item.status === "blocked" && deps.length > 0 && unmet.length === 0;
  const done = item.status === "done";

  function submitComment() {
    const text = comment.trim();
    if (!text) return;
    onMutate(item.id, { comment: text });
    setComment("");
  }

  return (
    <div
      className={[
        "rounded-[var(--radius-card)] border bg-surface-1 p-3.5 transition-colors",
        canStart ? "border-teal/40" : "border-line",
        done ? "opacity-75" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={() => onMutate(item.id, { status: done ? "ready" : "done" })}
          disabled={pending}
          title={done ? "Mark not done" : "Mark done"}
          className={[
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
            done ? "border-fresh bg-fresh text-surface-1" : "border-line-strong hover:border-fresh",
          ].join(" ")}
        >
          {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`text-sm font-semibold leading-snug text-text ${done ? "line-through decoration-faint" : ""}`}>
              {item.title}
            </h3>
            {pr && (
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${pr.bg} ${pr.text}`}>
                {pr.label}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {item.area}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-faint">
              {item.kind === "code" ? <Code2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
              {item.kind === "non-code" ? "form / writeup" : item.kind}
            </span>
          </div>
        </div>
      </div>

      {/* Status control */}
      <div className="mt-3 flex items-center gap-2">
        <div className="relative">
          <select
            value={item.status}
            onChange={(e) => onMutate(item.id, { status: e.target.value as RoadmapStatus })}
            disabled={pending}
            className={`appearance-none rounded-md border border-line bg-surface-1 py-1 pl-6 pr-7 text-xs font-medium ${meta.text} focus:border-teal focus:outline-none`}
          >
            {ROADMAP_STATUSES.map((s) => (
              <option key={s} value={s} className="text-text">
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <span className={`pointer-events-none absolute left-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${meta.dot}`} />
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        </div>
        {canStart && (
          <span className="inline-flex items-center gap-1 rounded bg-teal/10 px-1.5 py-0.5 text-[10px] font-medium text-teal">
            deps clear — ready to start
          </span>
        )}
      </div>

      {/* Dependencies */}
      {deps.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-faint">
            <Lock className="h-3 w-3" /> depends
          </span>
          {deps.map((d) => (
            <span
              key={d.id}
              title={d.title}
              className={[
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                d.status === "done" ? "bg-fresh/15 text-fresh" : "bg-dormant/15 text-dormant",
              ].join(" ")}
            >
              {d.status === "done" && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              {d.title.replace(/^[^:]+:\s*/, "")}
            </span>
          ))}
        </div>
      )}

      {/* Links */}
      {item.links.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {item.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-teal hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> {l.label}
            </a>
          ))}
        </div>
      )}

      {/* Body + log toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted hover:text-text"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide" : "Details"}
        {item.comments.length > 0 && (
          <span className="ml-0.5 rounded-full bg-surface-2 px-1.5 text-[10px] text-faint">
            {item.comments.length} log
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2.5 space-y-3 border-t border-line pt-3">
          {item.body && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{item.body}</p>
          )}

          {item.comments.length > 0 && (
            <ul className="space-y-1.5">
              {item.comments.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="shrink-0 font-mono text-[10px] text-faint">{c.date}</span>
                  <span className="text-muted">{c.text}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitComment()}
              placeholder="Add a status comment…"
              className="min-w-0 flex-1 rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-text placeholder:text-faint focus:border-teal focus:outline-none"
            />
            <button
              onClick={submitComment}
              disabled={pending || !comment.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-text px-2.5 py-1.5 text-xs font-medium text-surface-1 disabled:opacity-40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" /> Log
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
