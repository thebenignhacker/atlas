"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import type { StrategyDoc, StrategyPriority } from "@/lib/strategy-shared";
import { STRATEGY_PRIORITIES } from "@/lib/strategy-shared";

type PriorityFilter = "all" | Exclude<StrategyPriority, null>;

const PRIORITY_STYLE: Record<Exclude<StrategyPriority, null>, string> = {
  P0: "bg-rose/15 text-rose",
  P1: "bg-amber/15 text-amber",
  P2: "bg-surface-2 text-muted",
  P3: "bg-surface-2 text-faint",
};

function PriorityBadge({ p }: { p: StrategyPriority }) {
  if (!p) return null;
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${PRIORITY_STYLE[p]}`}
    >
      {p}
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-fresh/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-faint">
        {done}/{total}
      </span>
    </div>
  );
}

export function StrategyBoard({ docs }: { docs: StrategyDoc[] }) {
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [hideDone, setHideDone] = useState(false);

  const filtered = useMemo(() => {
    return docs.map((doc) => {
      const sections = doc.sections
        .map((s) => {
          const tasks = s.tasks.filter((t) => {
            if (priority !== "all" && t.priority !== priority) return false;
            if (hideDone && t.done) return false;
            return true;
          });
          return { ...s, tasks };
        })
        .filter((s) => s.tasks.length > 0);
      return { ...doc, sections };
    });
  }, [docs, priority, hideDone]);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-surface-2 text-text"
        : "text-muted hover:bg-surface-2/60 hover:text-text"
    }`;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button className={chip(priority === "all")} onClick={() => setPriority("all")}>
          All priorities
        </button>
        {STRATEGY_PRIORITIES.map((p) => (
          <button
            key={p}
            className={chip(priority === p)}
            onClick={() => setPriority(p)}
          >
            {p}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <button
          className={chip(hideDone)}
          onClick={() => setHideDone((v) => !v)}
          aria-pressed={hideDone}
        >
          {hideDone ? "Hiding done" : "Hide done"}
        </button>
      </div>

      {filtered.map((doc) => (
        <div key={doc.id} className="space-y-4">
          {doc.sections.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
              No tasks match this filter.
            </div>
          ) : (
            doc.sections.map((section) => (
              <section
                key={`${doc.id}:${section.title}`}
                className="rounded-[var(--radius-card)] border border-line bg-surface-1/60 p-5"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2
                      className={`font-display font-semibold tracking-tight text-text ${
                        section.level <= 2 ? "text-lg" : "text-base"
                      }`}
                    >
                      {section.title}
                    </h2>
                    {section.blurb && (
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-faint">
                        {section.blurb}
                      </p>
                    )}
                  </div>
                  <ProgressBar done={section.done} total={section.total} />
                </div>
                <ul className="space-y-1.5">
                  {section.tasks.map((t, i) => (
                    <li
                      key={`${section.title}:${i}`}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      {t.done ? (
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-fresh"
                          strokeWidth={2}
                        />
                      ) : (
                        <Circle
                          className="mt-0.5 h-4 w-4 shrink-0 text-faint"
                          strokeWidth={2}
                        />
                      )}
                      <PriorityBadge p={t.priority} />
                      <span
                        className={
                          t.done ? "text-faint line-through" : "text-text"
                        }
                      >
                        {t.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
