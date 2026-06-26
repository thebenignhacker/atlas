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
  Search,
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

export function RoadmapBoard({
  items,
  readOnly = false,
}: {
  items: RoadmapItem[];
  readOnly?: boolean;
}) {
  const [group, setGroup] = useState<"status" | "area">("status");
  const [area, setArea] = useState("all");
  const [priority, setPriority] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useState(false);
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

  // A blocked item is "ready to start" when it has dependencies and they are all
  // done — the same rule the card uses to flag "deps clear".
  const depsClear = (i: RoadmapItem) => {
    const deps = i.dependsOn.map((id) => byId[id]).filter(Boolean);
    return deps.length > 0 && deps.every((d) => d.status === "done");
  };

  const q = query.trim().toLowerCase();
  const visible = items.filter((i) => {
    if (area !== "all" && i.area !== area) return false;
    if (priority !== "all" && i.priority !== priority) return false;
    if (statusFilter === "active") {
      if (i.status !== "in-progress" && i.status !== "in-review") return false;
    } else if (statusFilter === "ready-to-start") {
      if (i.status !== "ready" && !depsClear(i)) return false;
    } else if (statusFilter !== "all" && i.status !== statusFilter) {
      return false;
    }
    if (hideDone && i.status === "done") return false;
    if (q && !`${i.title} ${i.area} ${i.id} ${i.body}`.toLowerCase().includes(q))
      return false;
    return true;
  });

  const filtersActive =
    area !== "all" ||
    priority !== "all" ||
    statusFilter !== "all" ||
    hideDone ||
    q !== "";

  function clearFilters() {
    setArea("all");
    setPriority("all");
    setStatusFilter("all");
    setQuery("");
    setHideDone(false);
  }

  // Quick "focus" chips — one-tap shortcuts onto the most common views. Each
  // toggles, so a second tap clears it. Track chips (Standards/GTM/Fundraise)
  // only appear when those areas exist in the data.
  const chips: { label: string; active: boolean; on: () => void }[] = [
    { label: "P0", active: priority === "P0", on: () => setPriority(priority === "P0" ? "all" : "P0") },
    { label: "In progress", active: statusFilter === "in-progress", on: () => setStatusFilter(statusFilter === "in-progress" ? "all" : "in-progress") },
    { label: "Ready to start", active: statusFilter === "ready-to-start", on: () => setStatusFilter(statusFilter === "ready-to-start" ? "all" : "ready-to-start") },
    { label: "Active", active: statusFilter === "active", on: () => setStatusFilter(statusFilter === "active" ? "all" : "active") },
  ];
  for (const t of ["Standards", "GTM", "Fundraise"]) {
    if (areas.includes(t)) {
      chips.push({ label: t, active: area === t, on: () => setArea(area === t ? "all" : t) });
    }
  }

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
    <RoadmapCard
      key={item.id}
      item={item}
      byId={byId}
      pending={pending}
      readOnly={readOnly}
      onMutate={mutate}
    />
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        {/* Quick focus chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] uppercase tracking-wide text-faint">Focus</span>
          {chips.map((c) => (
            <button
              key={c.label}
              onClick={c.on}
              className={[
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                c.active
                  ? "border-teal bg-teal/15 text-teal"
                  : "border-line bg-surface-1 text-muted hover:text-text",
              ].join(" ")}
            >
              {c.label}
            </button>
          ))}
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="rounded-full px-2 py-1 text-xs font-medium text-faint underline-offset-2 hover:text-text hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        {/* Controls */}
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

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search roadmap…"
              className="w-40 rounded-lg border border-line bg-surface-1 py-1.5 pl-8 pr-2.5 text-sm text-text placeholder:text-faint focus:border-teal focus:outline-none sm:w-48"
            />
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

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm text-text focus:border-teal focus:outline-none"
          >
            <option value="all">All priorities</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>

          <label className="inline-flex items-center gap-1.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="accent-teal"
            />
            Hide done
          </label>

          <span className="text-xs text-faint">
            {visible.length} of {items.length}
          </span>
          {pending && <span className="text-xs text-faint">saving…</span>}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
          No items match these filters.
          {filtersActive && (
            <button onClick={clearFilters} className="ml-1.5 text-teal hover:underline">
              Clear filters
            </button>
          )}
        </div>
      ) : group === "status" ? (
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
  readOnly,
  onMutate,
}: {
  item: RoadmapItem;
  byId: Record<string, RoadmapItem>;
  pending: boolean;
  readOnly: boolean;
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
        {readOnly ? (
          <span
            title={done ? "Done" : item.status}
            className={[
              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border",
              done ? "border-fresh bg-fresh text-surface-1" : "border-line",
            ].join(" ")}
          >
            {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
        ) : (
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
        )}
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
        {readOnly ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${meta.chip}`}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        ) : (
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
        )}
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

          {readOnly ? (
            item.comments.length === 0 && (
              <p className="text-[11px] text-faint">No log entries yet.</p>
            )
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}
