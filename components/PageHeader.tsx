import { relativeTime } from "@/lib/util/date";

export function PageHeader({
  title,
  subtitle,
  lastScanAt,
  children,
}: {
  title: string;
  subtitle?: string;
  lastScanAt?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-text md:text-[2.5rem] md:leading-[1.05]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {lastScanAt !== undefined && (
          <span className="inline-flex items-center gap-1.5 text-xs text-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-fresh/70" />
            scanned {relativeTime(lastScanAt ?? null)}
          </span>
        )}
      </div>
    </header>
  );
}

export function StatStrip({
  stats,
}: {
  stats: { label: string; value: string | number; accent?: string }[];
}) {
  return (
    <div className="mb-7 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[0_1px_0_rgba(33,28,21,0.03)] sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="atlas-stagger bg-surface-1 px-4 py-4"
          style={{ ["--i" as string]: i }}
        >
          <div
            className={`font-display text-[2rem] font-semibold leading-none tnum ${s.accent ?? "text-text"}`}
          >
            {s.value}
          </div>
          <div className="mt-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
