"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  GitFork,
  Search,
  SlidersHorizontal,
  Archive,
  ListTodo,
  Layers,
} from "lucide-react";
import type { RepoWithSignals } from "@/lib/queries";
import type { StalenessBucket } from "@/lib/types";
import { RepoCard } from "@/components/RepoCard";
import { OverviewCharts } from "@/components/OverviewCharts";
import { ShowMore } from "@/components/ShowMore";
import { STALENESS } from "@/lib/display";

type Sort = "activity" | "stars" | "name" | "attention";

const STALE_KEYS: StalenessBucket[] = ["fresh", "recent", "aging", "stale", "dormant"];

function sortRepos(list: RepoWithSignals[], sort: Sort): RepoWithSignals[] {
  return [...list].sort((a, b) => {
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
}

export function PortfolioView({
  repos,
  initialAttentionOnly = false,
  publicView = false,
  sampleAsOf = null,
}: {
  repos: RepoWithSignals[];
  initialAttentionOnly?: boolean;
  /**
   * The public snapshot holds only public repos and no todos, so there the
   * visibility filter cannot narrow the list and "Has todos" matches nothing;
   * the public view leaves both out.
   */
  publicView?: boolean;
  /** The collection date when the data is a frozen sample (`sampleNotice`), else null. */
  sampleAsOf?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [language, setLanguage] = useState("all");
  const [staleness, setStaleness] = useState("all");
  const [sort, setSort] = useState<Sort>("activity");
  const [attentionOnly, setAttentionOnly] = useState(initialAttentionOnly);
  const [todosOnly, setTodosOnly] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Below lg the charts start closed: that is also the server-rendered state.
  const [glanceOpen, setGlanceOpen] = useState(false);

  // `?attention=1` (where the "Need attention" stat links) turns the filter on.
  // This view stays mounted when that link is followed from this page, so the
  // filter follows the page's value when it changes, and the toggle keeps the
  // URL in step; otherwise a second visit to the link would leave the filter
  // off. The toggle goes through the router so the link still scrolls to #repos.
  const [seenInitial, setSeenInitial] = useState(initialAttentionOnly);
  if (initialAttentionOnly !== seenInitial) {
    setSeenInitial(initialAttentionOnly);
    setAttentionOnly(initialAttentionOnly);
  }
  const toggleAttention = () => {
    const next = !attentionOnly;
    setAttentionOnly(next);
    router.replace(next ? `${pathname}?attention=1` : pathname, { scroll: false });
  };

  const groups = useMemo(
    () =>
      Array.from(
        new Set(repos.map((r) => r.groupName).filter(Boolean) as string[])
      ).sort((a, b) => a.localeCompare(b)),
    [repos]
  );
  const languages = useMemo(
    () =>
      Array.from(new Set(repos.map((r) => r.language).filter(Boolean) as string[])).sort(
        (a, b) => a.localeCompare(b)
      ),
    [repos]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return repos.filter((r) => {
      if (group !== "all" && r.groupName !== group) return false;
      if (visibility !== "all" && r.visibility !== visibility) return false;
      if (language !== "all" && r.language !== language) return false;
      if (staleness !== "all" && r.signals.staleness !== staleness) return false;
      if (attentionOnly && r.signals.attention.length === 0) return false;
      if (todosOnly && r.openTodos === 0) return false;
      if (needle) {
        const hay = `${r.name} ${r.groupName ?? ""} ${r.description ?? ""} ${
          r.language ?? ""
        }`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [repos, q, group, visibility, language, staleness, attentionOnly, todosOnly]);

  // Search text or a filter narrows the list. The charts always describe every
  // repo, so while the list is narrowed they step aside and the matches follow
  // the filter bar. Sorting and grouping only rearrange the list.
  const filtersActive =
    q.trim() !== "" ||
    group !== "all" ||
    visibility !== "all" ||
    language !== "all" ||
    staleness !== "all" ||
    attentionOnly ||
    todosOnly;

  // Separate the user's own active work from forks/clones and archived repos.
  const primary = useMemo(
    () => filtered.filter((r) => r.isFork !== 1 && r.isArchived !== 1),
    [filtered]
  );
  const forks = useMemo(
    () => sortRepos(filtered.filter((r) => r.isFork === 1 && r.isArchived !== 1), sort),
    [filtered, sort]
  );
  const archived = useMemo(
    () => sortRepos(filtered.filter((r) => r.isArchived === 1), sort),
    [filtered, sort]
  );

  // Primary repos grouped by org, groups ordered by most-recent activity.
  const primaryGroups = useMemo(() => {
    if (!grouped) return null;
    const map = new Map<string, RepoWithSignals[]>();
    for (const r of primary) {
      const key = r.groupName || "Ungrouped";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([name, list]) => ({ name, repos: sortRepos(list, sort) }))
      .sort(
        (a, b) =>
          (b.repos[0]?.lastCommitAt ?? "").localeCompare(a.repos[0]?.lastCommitAt ?? "")
      );
  }, [primary, grouped, sort]);

  const flatPrimary = useMemo(() => sortRepos(primary, sort), [primary, sort]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-7">
      {/* Filter bar; the "Need attention" stat links here as #repos */}
      <div id="repos" className="scroll-mt-6 space-y-2.5">
        {/* On a phone the selects pair up under the search box. A last one left
            alone would get half a row and a cut-off label, so it takes the row. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center [&>:last-child:nth-child(even)]:col-span-2">
          <div className="relative col-span-2 sm:flex-1 sm:min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search repos…"
              aria-label="Search repositories"
              className="w-full rounded-lg border border-line bg-surface-1 py-2 pl-9 pr-3 text-sm text-text placeholder:text-faint focus:border-teal focus:outline-none"
            />
          </div>
          <Select label="Filter by organisation" value={group} onChange={setGroup}>
            <option value="all">All orgs</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select label="Filter by language" value={language} onChange={setLanguage}>
            <option value="all">All languages</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <Select label="Filter by freshness" value={staleness} onChange={setStaleness}>
            <option value="all">Any freshness</option>
            {STALE_KEYS.map((k) => (
              <option key={k} value={k}>
                {STALENESS[k].label}
              </option>
            ))}
          </Select>
          {!publicView && (
            <Select label="Filter by visibility" value={visibility} onChange={setVisibility}>
              <option value="all">All visibility</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
          )}
          {/* Alone on the phone grid's last row, so it takes all of it: "Recent activity" does not fit half. */}
          <Select label="Sort repositories" value={sort} onChange={(v) => setSort(v as Sort)} className="col-span-2">
            <option value="activity">Recent activity</option>
            <option value="stars">Most stars</option>
            <option value="attention">Needs attention</option>
            <option value="name">Name</option>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Toggle on={attentionOnly} onClick={toggleAttention} accent="clay">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Needs attention
          </Toggle>
          {!publicView && (
            <Toggle on={todosOnly} onClick={() => setTodosOnly((v) => !v)} accent="clay">
              <ListTodo className="h-3.5 w-3.5" /> Has todos
            </Toggle>
          )}
          <Toggle on={grouped} onClick={() => setGrouped((v) => !v)} accent="teal">
            <Layers className="h-3.5 w-3.5" /> Group by org
          </Toggle>
          <span className="ml-auto text-xs text-faint tnum">
            {filtered.length} of {repos.length} repos
          </span>
        </div>
      </div>

      {!filtersActive && (
        <div>
          {/* Below lg the charts sit behind this row so a phone reaches the list
              in a short scroll; from lg up the row is hidden and the charts show
              with their own heading, by CSS alone. */}
          <h2 className="lg:hidden">
            <button
              type="button"
              aria-expanded={glanceOpen}
              aria-controls="at-a-glance"
              onClick={() => setGlanceOpen((v) => !v)}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-card)] border border-line bg-surface-1 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal"
            >
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-faint transition-transform ${glanceOpen ? "" : "-rotate-90"}`}
              />
              <span className="font-display text-lg font-semibold tracking-tight text-text">
                At a glance
              </span>{" "}
              <span className="text-xs text-faint tnum">{repos.length} repos</span>
            </button>
          </h2>
          <div id="at-a-glance" className={glanceOpen ? "mt-3 lg:mt-0" : "hidden lg:block"}>
            <OverviewCharts repos={repos} sampleAsOf={sampleAsOf} />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
          No repos match these filters.
        </div>
      ) : (
        <div className="space-y-8">
          {/* Primary: owned/active work */}
          {grouped && primaryGroups ? (
            primaryGroups.map((g, i) => {
              // Open the two most-active workspaces; collapse the rest so the page
              // starts compact. A click on `collapsed` flips that per-group default.
              const key = `g:${g.name}`;
              const defaultCollapsed = i >= 2;
              const isCollapsed = collapsed.has(key) ? !defaultCollapsed : defaultCollapsed;
              return (
                <GroupBlock
                  key={g.name}
                  title={g.name}
                  repos={g.repos}
                  collapsed={isCollapsed}
                  onToggle={() => toggle(key)}
                />
              );
            })
          ) : (
            <RepoGrid repos={flatPrimary} />
          )}

          {forks.length > 0 && (
            <CollapsibleSection
              icon={GitFork}
              title="Forks & clones"
              count={forks.length}
              repos={forks}
              collapsed={!collapsed.has("open:forks")}
              onToggle={() => toggle("open:forks")}
            />
          )}
          {archived.length > 0 && (
            <CollapsibleSection
              icon={Archive}
              title="Archived"
              count={archived.length}
              repos={archived}
              collapsed={!collapsed.has("open:archived")}
              onToggle={() => toggle("open:archived")}
            />
          )}
        </div>
      )}
    </div>
  );
}

const REPO_PAGE = 12;

function RepoGrid({ repos }: { repos: RepoWithSignals[] }) {
  return (
    <ShowMore total={repos.length} initial={REPO_PAGE} step={REPO_PAGE} noun="repos">
      {(shown) => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {repos.slice(0, shown).map((r, i) => (
            // Restart the entrance stagger for each revealed page.
            <RepoCard key={r.slug} repo={r} index={i % REPO_PAGE} />
          ))}
        </div>
      )}
    </ShowMore>
  );
}

function GroupBlock({
  title,
  repos,
  collapsed,
  onToggle,
}: {
  title: string;
  repos: RepoWithSignals[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const attention = repos.filter((r) => r.signals.attention.length > 0).length;
  return (
    <section>
      <button
        onClick={onToggle}
        className="group mb-3 flex w-full items-center gap-2.5 text-left"
      >
        <ChevronDown
          className={`h-4 w-4 text-faint transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
        <h2 className="font-display text-lg font-semibold tracking-tight text-text">
          {title}
        </h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted tnum">
          {repos.length}
        </span>
        {attention > 0 && (
          <span className="rounded-full bg-clay/10 px-2 py-0.5 text-[11px] font-medium text-clay tnum">
            {attention} flagged
          </span>
        )}
        <span className="ml-2 h-px flex-1 bg-line" />
      </button>
      {!collapsed && <RepoGrid repos={repos} />}
    </section>
  );
}

function CollapsibleSection({
  icon: Icon,
  title,
  count,
  repos,
  collapsed,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  repos: RepoWithSignals[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface-2/40 p-4">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 text-left">
        <ChevronDown
          className={`h-4 w-4 text-faint transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
        <Icon className="h-4 w-4 text-faint" />
        <h2 className="text-sm font-semibold text-muted">{title}</h2>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-faint tnum">
          {count}
        </span>
        <span className="ml-2 h-px flex-1 bg-line" />
      </button>
      {!collapsed && (
        <div className="mt-4">
          <RepoGrid repos={repos} />
        </div>
      )}
    </section>
  );
}

function Toggle({
  on,
  onClick,
  accent,
  children,
}: {
  on: boolean;
  onClick: () => void;
  accent: "clay" | "teal";
  children: React.ReactNode;
}) {
  const active =
    accent === "clay"
      ? "border-clay/40 bg-clay/10 text-clay"
      : "border-teal/40 bg-teal/10 text-teal";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        on ? active : "border-line bg-surface-1 text-muted hover:text-text",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * The filters have no visible label, so `label` is the select's accessible name.
 * On a phone two selects share a row; the narrower padding there lets "Any freshness" fit.
 */
function Select<T extends string>({
  label,
  value,
  onChange,
  children,
  className = "",
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`w-full min-w-0 rounded-lg border border-line bg-surface-1 px-2.5 py-2 text-sm text-muted focus:border-teal focus:outline-none sm:w-auto sm:px-3 ${className}`}
    >
      {children}
    </select>
  );
}
