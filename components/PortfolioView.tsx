"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { RepoWithSignals } from "@/lib/queries";
import { RepoCard } from "@/components/RepoCard";

type Sort = "activity" | "stars" | "name" | "attention";

export function PortfolioView({ repos }: { repos: RepoWithSignals[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("activity");

  const groups = useMemo(
    () =>
      Array.from(new Set(repos.map((r) => r.groupName).filter(Boolean) as string[])).sort(
        (a, b) => a.localeCompare(b)
      ),
    [repos]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = repos.filter((r) => {
      if (group !== "all" && r.groupName !== group) return false;
      if (visibility !== "all" && r.visibility !== visibility) return false;
      if (attentionOnly && r.signals.attention.length === 0) return false;
      if (needle) {
        const hay = `${r.name} ${r.groupName ?? ""} ${r.description ?? ""} ${
          r.language ?? ""
        }`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "stars":
          return (b.stars ?? 0) - (a.stars ?? 0);
        case "name":
          return a.name.localeCompare(b.name);
        case "attention":
          return b.signals.attention.length - a.signals.attention.length;
        default:
          return (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? "");
      }
    });
    return list;
  }, [repos, q, group, visibility, attentionOnly, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search repos…"
            className="w-full rounded-lg border border-line bg-surface-1 py-2 pl-9 pr-3 text-sm text-text placeholder:text-faint focus:border-teal focus:outline-none"
          />
        </div>

        <Select value={group} onChange={setGroup}>
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>

        <Select value={visibility} onChange={setVisibility}>
          <option value="all">All visibility</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </Select>

        <Select value={sort} onChange={(v) => setSort(v as Sort)}>
          <option value="activity">Recent activity</option>
          <option value="stars">Most stars</option>
          <option value="attention">Needs attention</option>
          <option value="name">Name</option>
        </Select>

        <button
          onClick={() => setAttentionOnly((v) => !v)}
          className={[
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
            attentionOnly
              ? "border-amber/40 bg-amber/10 text-amber"
              : "border-line bg-surface-1 text-muted hover:text-text",
          ].join(" ")}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Attention
        </button>
      </div>

      <p className="text-xs text-faint">
        {filtered.length} of {repos.length} repos
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
          No repos match these filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((r) => (
            <RepoCard key={r.slug} repo={r} />
          ))}
        </div>
      )}
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
