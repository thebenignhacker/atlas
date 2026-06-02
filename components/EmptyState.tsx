import { Database } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Database className="mb-4 h-10 w-10 text-faint" strokeWidth={1.5} />
      <h2 className="text-lg font-semibold text-text">No data yet</h2>
      <p className="mt-2 max-w-md text-sm text-muted">
        Atlas hasn&apos;t scanned your workspace. Point{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-teal">
          atlas.config.json
        </code>{" "}
        at your project roots, then run:
      </p>
      <pre className="mt-4 rounded-lg border border-line bg-surface-1 px-4 py-3 text-left font-mono text-sm text-text">
        npm run setup-db{"\n"}npm run scan
      </pre>
    </div>
  );
}
