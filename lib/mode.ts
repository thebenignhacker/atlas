/**
 * Atlas runs in one of three data modes, selected by the ATLAS_MODE env var:
 *
 *  - "local"  (default): reads the local SQLite database. Full data, used by
 *    `npm run dev` on the owner's machine.
 *  - "public": reads the sanitized `public-snapshot.json`. No SQLite, no todos,
 *    no private data. This is the deployed public demo.
 *  - "owner":  reads the unsanitized `owner-snapshot.json` (all repos, todos,
 *    activity, digest, settings). Deployed behind GitHub OAuth -- only the owner
 *    sees it. The snapshot is NEVER committed; it is uploaded to the owner
 *    deployment by the Vercel CLI.
 *
 * Both snapshot modes exist because Vercel's serverless filesystem is read-only:
 * the host cannot open the SQLite DB, so a prebuilt JSON snapshot is the data
 * source. Keep this module dependency-free so any layer can ask the mode without
 * pulling in the DB or query stack.
 */
export type AtlasMode = "local" | "public" | "owner";

export function atlasMode(): AtlasMode {
  switch (process.env.ATLAS_MODE) {
    case "public":
      return "public";
    case "owner":
      return "owner";
    default:
      return "local";
  }
}

/** Public demo: sanitized snapshot, no private data. */
export function isPublicMode(): boolean {
  return atlasMode() === "public";
}

/** Owner deployment: full snapshot behind OAuth. */
export function isOwnerMode(): boolean {
  return atlasMode() === "owner";
}

/** Either deployed mode reads a JSON snapshot instead of the SQLite DB. */
export function isSnapshotMode(): boolean {
  return atlasMode() !== "local";
}
