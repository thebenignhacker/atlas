/**
 * Atlas runs in one of four data modes, selected by the ATLAS_MODE env var:
 *
 *  - "local"  (default): reads the local SQLite database. Full data, used by
 *    `npm run dev` on the owner's machine.
 *  - "public": reads the sanitized `public-snapshot.json`. No SQLite, no todos,
 *    no private data. A deployed public demo.
 *  - "owner":  reads the unsanitized `owner-snapshot.json` (all repos, todos,
 *    activity). A deployed, fully-private deployment.
 *  - "unified": ONE deployment that carries BOTH snapshots and decides PER
 *    REQUEST — a request with a valid owner session sees owner data, everyone
 *    else sees public data. The env var alone never grants owner access; only a
 *    verified session does (see lib/request-mode.ts). This is how the public
 *    showcase and the private view live on a single Vercel project.
 *
 * Snapshot modes exist because Vercel's serverless filesystem is read-only: the
 * host cannot open the SQLite DB, so a prebuilt JSON snapshot is the data source.
 * Keep this module dependency-free so any layer can ask the env mode without
 * pulling in the DB, the auth stack, or next/headers.
 */
export type AtlasMode = "local" | "public" | "owner" | "unified";

/** The data mode AFTER per-request resolution — what a query actually reads. */
export type ResolvedMode = "local" | "public" | "owner";

export function atlasMode(): AtlasMode {
  switch (process.env.ATLAS_MODE) {
    case "public":
      return "public";
    case "owner":
      return "owner";
    case "unified":
      return "unified";
    default:
      return "local";
  }
}

/** Public demo: sanitized snapshot, no private data. */
export function isPublicMode(): boolean {
  return atlasMode() === "public";
}

/** Owner deployment: full snapshot. */
export function isOwnerMode(): boolean {
  return atlasMode() === "owner";
}

/** Any deployed mode reads a JSON snapshot instead of the SQLite DB. */
export function isSnapshotMode(): boolean {
  return atlasMode() !== "local";
}
