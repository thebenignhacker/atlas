import { Lock, ShieldCheck, Sparkles, Brain, CircleDollarSign } from "lucide-react";
import { loadConfig } from "@/lib/config";
import { aiAvailability } from "@/lib/ai/provider";
import { getCostSummary } from "@/lib/ai/cache";
import { getFeedback } from "@/lib/ai/learning";
import { isRepoAIEligible } from "@/lib/ai/policy";
import { getRepos } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { relativeTime } from "@/lib/util/date";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  let repos;
  try {
    repos = getRepos();
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  const config = loadConfig();
  const avail = aiAvailability();
  const cost = getCostSummary();
  const feedback = getFeedback(50);
  const eligible = repos.filter((r) => isRepoAIEligible(r));
  const excluded = repos.filter((r) => !isRepoAIEligible(r));

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader title="Settings" subtitle="AI, privacy, and what Atlas has learned." />

      <div className="space-y-6">
        <Section icon={Sparkles} title="AI layer">
          <Row label="Status">
            {avail.ok ? (
              <span className="text-fresh">on · {avail.provider}</span>
            ) : (
              <span className="text-amber">off — {avail.reason}</span>
            )}
          </Row>
          <Row label="Provider">{config.ai.provider}</Row>
          <Row label="Fast model">
            <code className="font-mono text-teal">{config.ai.models.fast}</code>
          </Row>
          <Row label="Deep model">
            <code className="font-mono text-teal">{config.ai.models.deep}</code>
          </Row>
          <p className="pt-1 text-xs text-faint">
            Atlas is fully usable with AI off. Edit{" "}
            <code className="font-mono text-teal">atlas.config.json</code> to change
            these.
          </p>
        </Section>

        <Section icon={CircleDollarSign} title="Usage & cost">
          <Row label="Cached AI calls">{cost.calls}</Row>
          <Row label="Prompt tokens">{cost.promptTokens.toLocaleString()}</Row>
          <Row label="Completion tokens">{cost.completionTokens.toLocaleString()}</Row>
          <p className="pt-1 text-xs text-faint">
            Results are cached by content hash — re-scanning never re-spends tokens
            unless the underlying content changed.
          </p>
        </Section>

        <Section icon={ShieldCheck} title="Privacy — what gets sent">
          <p className="text-sm text-muted">
            When the AI layer runs, Atlas sends repo metadata, README text, and todo
            titles for <strong className="text-text">eligible</strong> repos to your
            chosen provider. Everything else stays on your machine. Local git facts,
            private-repo content, and the SQLite database are never sent unless you opt
            in.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-line bg-surface-2 px-4 py-3">
              <div className="text-2xl font-semibold text-teal">{eligible.length}</div>
              <div className="text-[11px] uppercase tracking-wide text-faint">
                AI-eligible
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 px-4 py-3">
              <div className="text-2xl font-semibold text-text">{excluded.length}</div>
              <div className="text-[11px] uppercase tracking-wide text-faint">
                Excluded (private / not opted in)
              </div>
            </div>
          </div>
          {excluded.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-muted hover:text-text">
                Opt a private repo into AI
              </summary>
              <p className="mt-2 text-xs text-faint">
                Add its slug to{" "}
                <code className="font-mono text-teal">ai.optInRepos</code> in
                atlas.config.json, or set{" "}
                <code className="font-mono text-teal">ai.allowPrivate</code> to include
                all. Slugs:
              </p>
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {excluded.slice(0, 60).map((r) => (
                  <span
                    key={r.slug}
                    className="inline-flex items-center gap-1 rounded bg-surface-3 px-2 py-0.5 font-mono text-[11px] text-muted"
                  >
                    <Lock className="h-3 w-3 text-faint" />
                    {r.slug}
                  </span>
                ))}
              </div>
            </details>
          )}
        </Section>

        <Section icon={Brain} title="What Atlas learned about you">
          {feedback.length === 0 ? (
            <p className="text-sm text-faint">
              No corrections yet. When you fix something the AI got wrong, Atlas records
              it here and feeds it back into future prompts — so it stops repeating the
              mistake.
            </p>
          ) : (
            <div className="space-y-2">
              {feedback.map((f, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                >
                  <span className="text-faint">{f.entityId}</span>{" "}
                  <span className="text-muted">{f.field}</span> →{" "}
                  <span className="text-text">{f.correctedValue}</span>
                  {f.note && <span className="text-faint"> ({f.note})</span>}
                  <span className="ml-2 text-[11px] text-faint">
                    {relativeTime(f.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface-1 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <Icon className="h-4 w-4 text-muted" />
        {title}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}
