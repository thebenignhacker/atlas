import { getArtifactBuiltAt, getDecisions, getDecisionSkips, getFreshness } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { OwnerOnly } from "@/components/OwnerOnly";
import type { Decision, DecisionSkip } from "@/lib/types";

export const dynamic = "force-dynamic";

const CLASS_LABEL: Record<Decision["klass"], string> = {
  adopted: "adopted",
  "queued-for-owner": "queued for you",
  conflict: "conflict",
  superseding: "superseding",
  reversal: "reversal",
};

const CLASS_ACCENT: Record<Decision["klass"], string> = {
  adopted: "border-teal/40 text-teal",
  "queued-for-owner": "border-amber/50 text-amber",
  conflict: "border-rose/50 text-rose",
  superseding: "border-line text-dim",
  reversal: "border-rose/50 text-rose",
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function Field({ name, value }: { name: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="text-sm text-dim">
      <span className="text-faint">{name}: </span>
      {value}
    </p>
  );
}

function DecisionCard({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge label={CLASS_LABEL[d.klass]} className={CLASS_ACCENT[d.klass]} />
        <Badge
          label={d.status}
          className={
            d.status === "pending"
              ? "border-amber/50 text-amber"
              : d.status === "executed"
                ? "border-fresh/40 text-fresh"
                : "border-line text-faint"
          }
        />
        {d.chief && <Badge label={d.chief} className="border-line text-dim" />}
        {d.tree && <Badge label={d.tree} className="border-line text-faint" />}
        <span className="ml-auto text-xs text-faint">{d.date ?? ""}</span>
      </div>
      <h2 className="mt-2 text-sm font-semibold text-text">{d.title}</h2>
      <p className="mt-1 text-sm text-text">{d.decision}</p>
      <div className="mt-2 space-y-1">
        <Field name="Why" value={d.why} />
        <Field name="Alternatives" value={d.alternatives} />
        <Field name="Revert" value={d.reversibility} />
        <Field name="Review trigger" value={d.reviewTrigger} />
        {d.supersedes && <Field name="Supersedes" value={d.supersedes} />}
        <Field name="Links" value={d.links} />
      </div>
      {d.body && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-faint hover:text-dim">
            detail
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-surface-2 p-3 text-xs text-dim">
            {d.body}
          </pre>
        </details>
      )}
    </article>
  );
}

/**
 * A card file the strict parser refused. The parser is closed by spec (fix the
 * card, not the parser), so the useful thing to show is the file and the
 * reason — never a blank card that would read as a decision with no content.
 */
function SkippedCard({ k }: { k: DecisionSkip }) {
  return (
    <article className="rounded-lg border border-rose/40 bg-surface-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge label="not ingested" className="border-rose/50 text-rose" />
        <code className="text-xs text-text">{k.filename}</code>
        <span className="ml-auto text-xs text-faint">{k.modifiedAt.slice(0, 10)}</span>
      </div>
      <p className="mt-1 text-sm text-dim">{k.reason}</p>
    </article>
  );
}

export default async function DecisionsPage() {
  const mode = await getRequestMode();
  if (mode === "public") return <OwnerOnly feature="Decisions" />;
  let decisions: Decision[];
  let skips: DecisionSkip[];
  try {
    decisions = getDecisions(mode);
    skips = getDecisionSkips(mode);
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  const queued = decisions.filter(
    (d) => d.klass === "queued-for-owner" && d.status === "pending"
  );
  const conflicts = decisions.filter((d) => d.klass === "conflict" && d.status === "pending");
  const rest = decisions.filter((d) => !queued.includes(d) && !conflicts.includes(d));

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Decisions"
        subtitle="Every auto-adopted recommendation and queued action — what was chosen, why, and how to revert."
        freshness={getFreshness(mode, "decisions")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <StatStrip
        stats={[
          { label: "Total", value: decisions.length },
          {
            label: "Adopted",
            value: decisions.filter((d) => d.klass === "adopted").length,
          },
          {
            label: "Queued for you",
            value: queued.length,
            accent: queued.length ? "text-amber" : "text-text",
          },
          {
            label: "Conflicts",
            value: conflicts.length,
            accent: conflicts.length ? "text-rose" : "text-text",
          },
          {
            label: "Not ingested",
            value: skips.length,
            accent: skips.length ? "text-rose" : "text-text",
          },
        ]}
      />

      {skips.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose">
            Not ingested — {skips.length} card file{skips.length === 1 ? "" : "s"} the parser refused
          </h2>
          <p className="mb-2 text-xs text-faint">
            The card format is append-only and the parser is closed by spec: fix the card, not the
            parser. Queued-for-owner cards in this list are waiting on you and do not appear above
            until they parse.
          </p>
          <div className="space-y-2">
            {skips.map((k) => (
              <SkippedCard key={k.id} k={k} />
            ))}
          </div>
        </section>
      )}
      {queued.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber">
            Queued for you — pre-staged, waiting on your hands or authority
          </h2>
          <div className="space-y-3">
            {queued.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
      {conflicts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose">
            Unresolved conflicts — both positions carried intact
          </h2>
          <div className="space-y-3">
            {conflicts.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
          Decision history
        </h2>
        {rest.length === 0 ? (
          <p className="text-sm text-faint">No decisions recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {rest.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
