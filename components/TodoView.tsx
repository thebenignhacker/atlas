"use client";

import { useMemo, useState } from "react";
import { Search, FileCode, AlarmClock, Zap } from "lucide-react";
import type { Todo } from "@/lib/types";
import { PRIORITY } from "@/lib/display";
import { daysSince, relativeTime } from "@/lib/util/date";

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function TodoView({
  todos,
  repoMap,
}: {
  todos: Todo[];
  repoMap: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("all");
  const [status, setStatus] = useState("open");
  const [repo, setRepo] = useState("all");
  const [staleOnly, setStaleOnly] = useState(false);

  const repos = useMemo(
    () =>
      Array.from(new Set(todos.map((t) => t.repoSlug).filter(Boolean) as string[]))
        .map((slug) => ({ slug, name: repoMap[slug] ?? slug }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [todos, repoMap]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = todos.filter((t) => {
      if (priority !== "all" && t.priority !== priority) return false;
      if (status !== "all" && t.status !== status) return false;
      if (repo !== "all" && t.repoSlug !== repo) return false;
      if (staleOnly) {
        const age = daysSince(t.createdAt);
        if (t.status !== "open" || age === null || age < 30) return false;
      }
      if (needle && !`${t.title} ${t.excerpt}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
    return list.sort((a, b) => {
      const pa = a.priority ? PRIORITY_ORDER[a.priority] : 9;
      const pb = b.priority ? PRIORITY_ORDER[b.priority] : 9;
      if (pa !== pb) return pa - pb;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });
  }, [todos, q, priority, status, repo, staleOnly]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search todos…"
            className="w-full rounded-lg border border-line bg-surface-1 py-2 pl-9 pr-3 text-sm text-text placeholder:text-faint focus:border-teal focus:outline-none"
          />
        </div>
        <Select value={status} onChange={setStatus}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="archived">Archived</option>
          <option value="all">All status</option>
        </Select>
        <Select value={priority} onChange={setPriority}>
          <option value="all">All priorities</option>
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </Select>
        <Select value={repo} onChange={setRepo}>
          <option value="all">All repos</option>
          {repos.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.name}
            </option>
          ))}
        </Select>
        <button
          onClick={() => setStaleOnly((v) => !v)}
          className={[
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
            staleOnly
              ? "border-amber/40 bg-amber/10 text-amber"
              : "border-line bg-surface-1 text-muted hover:text-text",
          ].join(" ")}
        >
          <AlarmClock className="h-4 w-4" /> Stale 30d+
        </button>
      </div>

      <p className="text-xs text-faint">
        {filtered.length} of {todos.length} todos
      </p>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
            No todos match these filters.
          </div>
        )}
        {filtered.map((t) => (
          <TodoRow key={t.id} todo={t} repoName={t.repoSlug ? repoMap[t.repoSlug] : null} />
        ))}
      </div>
    </div>
  );
}

function TodoRow({ todo, repoName }: { todo: Todo; repoName: string | null }) {
  const age = daysSince(todo.createdAt);
  const stale = todo.status === "open" && age !== null && age >= 30;
  return (
    <div className="atlas-fade flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface-1 px-4 py-3 transition-colors hover:border-line-strong">
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
          todo.priority ? PRIORITY[todo.priority].bg : "bg-faint/10"
        } ${todo.priority ? PRIORITY[todo.priority].text : "text-faint"}`}
      >
        {todo.priority ?? "—"}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{todo.title}</span>
          {todo.status === "done" && (
            <span className="shrink-0 rounded bg-fresh/15 px-1.5 py-0.5 text-[10px] font-medium text-fresh">
              done
            </span>
          )}
        </div>
        {todo.excerpt && (
          <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{todo.excerpt}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          {repoName && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-muted">
              {repoName}
            </span>
          )}
          <span>{todo.kind}</span>
          <span className={stale ? "text-amber" : ""}>
            {relativeTime(todo.createdAt)}
          </span>
          {todo.triggerPhrase && (
            <span className="inline-flex items-center gap-1 text-purple">
              <Zap className="h-3 w-3" />
              {todo.triggerPhrase.replace(/[`"]/g, "").slice(0, 40)}
            </span>
          )}
        </div>
      </div>

      <a
        href={`vscode://file${todo.path}`}
        title="Open in editor"
        className="mt-0.5 shrink-0 rounded-md border border-line p-1.5 text-faint transition-colors hover:border-line-strong hover:text-text"
      >
        <FileCode className="h-4 w-4" />
      </a>
    </div>
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
