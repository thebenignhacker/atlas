import Link from "next/link";
import { GitFork, Lock, Star, ListTodo, GitPullRequest } from "lucide-react";
import type { RepoWithSignals } from "@/lib/queries";
import { STALENESS, languageColor } from "@/lib/display";
import { relativeTime } from "@/lib/util/date";

export function RepoCard({ repo, index = 0 }: { repo: RepoWithSignals; index?: number }) {
  const stale = STALENESS[repo.signals.staleness];
  const attention = repo.signals.attention;

  return (
    <Link
      href={`/repo/${repo.slug}`}
      style={{ ["--i" as string]: index }}
      className="atlas-stagger group relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface-1 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_8px_24px_-12px_rgba(33,28,21,0.18)]"
    >
      {/* Staleness spine: a quiet color edge that turns the grid into a heat map. */}
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${stale.dot} opacity-70`}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13.5px] font-semibold text-text">
              {repo.name}
            </span>
            {repo.visibility === "private" && (
              <Lock className="h-3.5 w-3.5 shrink-0 text-faint" />
            )}
            {repo.isFork === 1 && (
              <GitFork className="h-3.5 w-3.5 shrink-0 text-faint" />
            )}
          </div>
          {repo.groupName && (
            <span className="text-[11px] uppercase tracking-wide text-faint">
              {repo.groupName}
            </span>
          )}
        </div>
        <div
          className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[11px]"
          title={stale.label}
        >
          <span className={`h-2 w-2 rounded-full ${stale.dot}`} />
          <span className={`tnum ${stale.text}`}>{relativeTime(repo.lastCommitAt)}</span>
        </div>
      </div>

      <p className="line-clamp-2 min-h-[2.5rem] pl-1 text-[13px] leading-snug text-muted">
        {repo.description || repo.lastCommitMsg || "No description."}
      </p>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 pl-1 text-[11px] text-muted tnum">
        {repo.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full ring-1 ring-black/5"
              style={{ background: languageColor(repo.language) }}
            />
            {repo.language}
          </span>
        )}
        {repo.commitCount30d > 0 && (
          <span className="text-faint">{repo.commitCount30d}/30d</span>
        )}
        {repo.stars ? (
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3" /> {repo.stars}
          </span>
        ) : null}
        {repo.openPrs ? (
          <span className="flex items-center gap-1 text-teal">
            <GitPullRequest className="h-3 w-3" /> {repo.openPrs}
          </span>
        ) : null}
        {repo.openTodos ? (
          <span className="flex items-center gap-1">
            <ListTodo className="h-3 w-3" /> {repo.openTodos}
          </span>
        ) : null}
      </div>

      {attention.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {attention.slice(0, 3).map((a) => (
            <span
              key={a}
              className="rounded-md bg-clay/10 px-2 py-0.5 text-[10.5px] font-medium text-clay"
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
