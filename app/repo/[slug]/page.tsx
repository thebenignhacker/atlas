import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  GitFork,
  Lock,
  Star,
} from "lucide-react";
import {
  getRepo,
  getActivityForRepo,
  getTodos,
  getRepoSummary,
  isPublicMode,
  isOwnerMode,
} from "@/lib/queries";
import { STALENESS, languageColor, PRIORITY } from "@/lib/display";
import { relativeTime } from "@/lib/util/date";
import { aiAvailability } from "@/lib/ai/provider";
import { isRepoAIEligible, eligibilityReason } from "@/lib/ai/policy";
import { RepoSummary } from "@/components/RepoSummary";
import { AiBadge } from "@/components/AiBadge";

export const dynamic = "force-dynamic";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let repo;
  try {
    repo = getRepo(slug);
  } catch {
    notFound();
  }
  if (!repo) notFound();

  const publicMode = isPublicMode();
  // Both deployed modes show the AI summary read-only (the host can't generate).
  const readOnly = publicMode || isOwnerMode();
  const todos = getTodos({ repoSlug: slug });
  const activity = getActivityForRepo(slug, 25);
  const stale = STALENESS[repo.signals.staleness];
  const avail = aiAvailability();
  const eligible = !readOnly && isRepoAIEligible(repo);
  const initialSummary = getRepoSummary(slug);
  const webUrl =
    repo.owner && repo.repoName
      ? `https://github.com/${repo.owner}/${repo.repoName}`
      : null;

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" /> Portfolio
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-text">
              {repo.name}
            </h1>
            {repo.visibility === "private" && <Lock className="h-4 w-4 text-faint" />}
            {repo.isFork === 1 && <GitFork className="h-4 w-4 text-faint" />}
          </div>
          <p className="mt-1 text-sm text-muted">
            {repo.groupName}
            {repo.path && (
              <>
                {" · "}
                <span className="font-mono text-faint">{repo.path}</span>
              </>
            )}
          </p>
        </div>
        {webUrl && (
          <a
            href={webUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-muted hover:text-text"
          >
            <ExternalLink className="h-4 w-4" /> GitHub
          </a>
        )}
      </header>

      {repo.description && (
        <p className="mb-6 max-w-2xl text-sm text-muted">{repo.description}</p>
      )}

      <div className="mb-6">
        {readOnly ? (
          initialSummary ? (
            <section className="rounded-[var(--radius-card)] border border-purple/20 bg-surface-1 p-4">
              <div className="mb-2">
                <AiBadge label="Summary" />
              </div>
              <p className="text-sm leading-relaxed text-muted">{initialSummary}</p>
            </section>
          ) : null
        ) : (
          <RepoSummary
            slug={slug}
            available={avail.ok}
            eligible={eligible}
            eligibleReason={eligibilityReason(repo)}
            initial={initialSummary}
          />
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Last commit">
          <span className={stale.text}>{relativeTime(repo.lastCommitAt)}</span>
        </Fact>
        <Fact label="Branch">
          <span className="inline-flex items-center gap-1 font-mono text-sm">
            <GitBranch className="h-3.5 w-3.5 text-faint" /> {repo.branch ?? "—"}
          </span>
        </Fact>
        <Fact label="Language">
          {repo.language ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: languageColor(repo.language) }}
              />
              {repo.language}
            </span>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label="Stars">
          <span className="inline-flex items-center gap-1 text-sm">
            <Star className="h-3.5 w-3.5 text-faint" /> {repo.stars ?? 0}
          </span>
        </Fact>
        <Fact label="Commits (30d)">{repo.commitCount30d}</Fact>
        <Fact label="Open issues">{repo.openIssues ?? "—"}</Fact>
        <Fact label="Open PRs">{repo.openPrs ?? "—"}</Fact>
        <Fact label="Working tree">
          {repo.dirty ? (
            <span className="text-amber">dirty</span>
          ) : (
            <span className="text-fresh">clean</span>
          )}
        </Fact>
      </div>

      {repo.signals.attention.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {repo.signals.attention.map((a) => (
            <span
              key={a}
              className="rounded-md bg-amber/10 px-2.5 py-1 text-xs font-medium text-amber"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-text">
            Linked todos{" "}
            <span className="font-normal text-faint">({todos.length})</span>
          </h2>
          <div className="space-y-2">
            {todos.length === 0 && (
              <p className="text-sm text-faint">No todos linked to this repo.</p>
            )}
            {todos.slice(0, 12).map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2"
              >
                {t.priority && (
                  <span
                    className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY[t.priority].bg} ${PRIORITY[t.priority].text}`}
                  >
                    {t.priority}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm text-text">{t.title}</div>
                  <div className="text-[11px] text-faint">
                    {t.status} · {t.createdAt}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-text">Recent commits</h2>
          <div className="space-y-2">
            {activity.length === 0 && (
              <p className="text-sm text-faint">No recent commits.</p>
            )}
            {activity.map((a) => (
              <div
                key={a.id}
                className="rounded-lg border border-line bg-surface-1 px-3 py-2"
              >
                <div className="truncate text-sm text-text">{a.title}</div>
                <div className="text-[11px] text-faint">{relativeTime(a.ts)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 text-text">{children}</div>
    </div>
  );
}
