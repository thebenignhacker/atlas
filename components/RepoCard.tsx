import Link from "next/link";
import { GitFork, Lock, Star, ListTodo, GitPullRequest } from "lucide-react";
import type { RepoWithSignals } from "@/lib/queries";
import { STALENESS, languageColor } from "@/lib/display";
import { relativeTime } from "@/lib/util/date";

export function RepoCard({ repo }: { repo: RepoWithSignals }) {
  const stale = STALENESS[repo.signals.staleness];
  const attention = repo.signals.attention;

  return (
    <Link
      href={`/repo/${repo.slug}`}
      className="atlas-fade group flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface-1 p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-medium text-text">
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
            <span className="text-[11px] text-faint">{repo.groupName}</span>
          )}
        </div>
        <div
          className="mt-1 flex shrink-0 items-center gap-1.5 text-[11px]"
          title={stale.label}
        >
          <span className={`h-2 w-2 rounded-full ${stale.dot}`} />
          <span className={stale.text}>{relativeTime(repo.lastCommitAt)}</span>
        </div>
      </div>

      <p className="line-clamp-2 min-h-[2.5rem] text-[13px] leading-snug text-muted">
        {repo.description || repo.lastCommitMsg || "No description."}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted">
        {repo.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: languageColor(repo.language) }}
            />
            {repo.language}
          </span>
        )}
        {repo.stars ? (
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3" /> {repo.stars}
          </span>
        ) : null}
        {repo.openPrs ? (
          <span className="flex items-center gap-1">
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
        <div className="flex flex-wrap gap-1.5">
          {attention.slice(0, 3).map((a) => (
            <span
              key={a}
              className="rounded-md bg-amber/10 px-2 py-0.5 text-[10.5px] font-medium text-amber"
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
