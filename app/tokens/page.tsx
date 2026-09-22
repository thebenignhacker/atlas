import { getArtifactBuiltAt, getFreshness, getTokens } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { OwnerOnly } from "@/components/OwnerOnly";
import type { TokenRollup } from "@/lib/usage/token-rollup";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString();
const kfmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));
const usd = (n: number) => `~$${n.toFixed(2)}`;
const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(0)}%`);

function Label({ text }: { text: string }) {
  return <p className="mb-3 text-xs text-faint">{text}</p>;
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-2 py-1 text-xs font-medium text-faint ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={`px-2 py-1 text-sm ${right ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""}`}>
      {children}
    </td>
  );
}

function Sessions({ t }: { t: TokenRollup }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-base font-semibold">Sessions, most expensive first</h2>
      <Label text={`Tokens ${t.labels.tokens}. Cost ${t.labels.cost}. Prefix: the context the next turn re-bills in full.`} />
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>session</Th><Th>repo</Th><Th>last seen</Th><Th right>turns</Th><Th right>requests</Th>
              <Th right>input</Th><Th right>cache write</Th><Th right>cache read</Th><Th right>output</Th>
              <Th right>cache hit</Th><Th right>prefix max</Th><Th right>prefix median</Th><Th right>cost (est.)</Th>
            </tr>
          </thead>
          <tbody>
            {t.sessions.slice(0, 60).map((s) => (
              <tr key={s.sessionId} className="border-b border-line/50">
                <Td mono>{s.sessionId.slice(0, 8)}</Td>
                <Td>{s.project ?? "unknown"}</Td>
                <Td mono>{s.lastAt?.slice(0, 16).replace("T", " ") ?? "—"}</Td>
                <Td right>{fmt(s.turns)}</Td><Td right>{fmt(s.requests)}</Td>
                <Td right>{kfmt(s.input)}</Td><Td right>{kfmt(s.cacheCreation)}</Td><Td right>{kfmt(s.cacheRead)}</Td><Td right>{kfmt(s.output)}</Td>
                <Td right>{pct(s.cacheHitRatio)}</Td><Td right>{kfmt(s.prefixMax)}</Td><Td right>{kfmt(s.prefixMedian)}</Td>
                <Td right>{usd(s.costEstimate)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Repos({ t }: { t: TokenRollup }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-base font-semibold">Per repo</h2>
      <Label text={`Cost ${t.labels.cost}.`} />
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>repo</Th><Th right>sessions</Th><Th right>requests</Th><Th right>input</Th><Th right>cache write</Th><Th right>cache read</Th><Th right>output</Th><Th right>cost (est.)</Th>
            </tr>
          </thead>
          <tbody>
            {t.repos.map((r) => (
              <tr key={r.project} className="border-b border-line/50">
                <Td>{r.project}</Td><Td right>{fmt(r.sessions)}</Td><Td right>{fmt(r.requests)}</Td>
                <Td right>{kfmt(r.input)}</Td><Td right>{kfmt(r.cacheCreation)}</Td><Td right>{kfmt(r.cacheRead)}</Td><Td right>{kfmt(r.output)}</Td>
                <Td right>{usd(r.costEstimate)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Days({ t }: { t: TokenRollup }) {
  const max = Math.max(1, ...t.days.map((d) => d.costEstimate));
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-base font-semibold">Per day, trailing 30</h2>
      <Label text={`Bars are cost, ${t.labels.cost.split(",")[0]}.`} />
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {t.days.map((d) => (
          <div key={d.day} className="flex-1 rounded-t bg-teal/60" style={{ height: `${Math.max(2, (d.costEstimate / max) * 96)}px` }}
            title={`${d.day}: ${fmt(d.requests)} requests, ${usd(d.costEstimate)}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-faint">{t.days[0]?.day} to {t.days[t.days.length - 1]?.day}</p>
    </section>
  );
}

function Carry({ t }: { t: TokenRollup }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-base font-semibold">Carried context by source</h2>
      <Label text={`Carry ${t.labels.carry}. A row names the file and tool so a session can act on it: read less, or read once.`} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full">
            <thead><tr className="border-b border-line"><Th>tool</Th><Th right>calls</Th><Th right>tokens/call (est.)</Th><Th right>carry (est.)</Th><Th right>share</Th></tr></thead>
            <tbody>
              {t.carryByTool.slice(0, 12).map((c) => (
                <tr key={c.tool} className="border-b border-line/50">
                  <Td>{c.tool}</Td><Td right>{fmt(c.calls)}</Td><Td right>{fmt(Math.round(c.resultTokensEst / Math.max(1, c.calls)))}</Td>
                  <Td right>{kfmt(c.carryEst)}</Td><Td right>{pct(c.share)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full">
            <thead><tr className="border-b border-line"><Th>file : tool</Th><Th right>calls</Th><Th right>carry (est.)</Th></tr></thead>
            <tbody>
              {t.carryByFile.map((c) => (
                <tr key={`${c.file}:${c.tool}`} className="border-b border-line/50">
                  <Td mono>{c.file}:{c.tool}</Td><Td right>{fmt(c.calls)}</Td><Td right>{kfmt(c.carryEst)}</Td>
                </tr>
              ))}
              {t.carryByFile.length === 0 && (
                <tr><Td>no tool call named a file</Td><Td right>—</Td><Td right>—</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default async function TokensPage() {
  const mode = await getRequestMode();
  if (mode === "public") return <OwnerOnly feature="Tokens" />;
  let t: TokenRollup;
  try {
    t = getTokens(mode);
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }
  const stats = [
    { label: "Requests", value: fmt(t.totals.requests) },
    { label: "Sessions", value: fmt(t.totals.sessions) },
    { label: "Cache hit", value: pct(t.totals.cacheHitRatio) },
    { label: "Output tokens", value: kfmt(t.totals.output) },
    { label: "Carry (est.)", value: kfmt(t.totals.carryEst), accent: "text-amber" },
    { label: "Cost (est.)", value: usd(t.totals.costEstimate), accent: "text-amber" },
  ];
  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Tokens"
        subtitle="What the coding sessions cost, from the transcripts: tokens per session and repo, the context each turn re-bills, and which tool results carry it."
        freshness={getFreshness(mode, "tokens")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <StatStrip stats={stats} />
      {t.totals.requests === 0 ? (
        <p className="mt-6 text-sm text-dim">No requests mined yet. Run <code>npm run scan:usage</code>; token rows are mined beside the tool events.</p>
      ) : (
        <>
          <Sessions t={t} />
          <Repos t={t} />
          <Days t={t} />
          <Carry t={t} />
        </>
      )}
      <p className="mt-6 text-xs text-faint">{t.headroom?.note ?? "account headroom: unavailable"}</p>
    </div>
  );
}
