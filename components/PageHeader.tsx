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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {lastScanAt !== undefined && (
          <span className="text-xs text-faint">
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
    <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface-1 px-4 py-3">
          <div className={`text-2xl font-semibold ${s.accent ?? "text-text"}`}>
            {s.value}
          </div>
          <div className="mt-0.5 text-[11px] uppercase tracking-wide text-faint">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
