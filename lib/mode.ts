/**
 * Atlas runs in one of four data modes, selected by the ATLAS_MODE env var:
 *
 *  - "local": reads the local SQLite database. Full data, used by `npm run dev`
 *    on the owner's machine, which sets ATLAS_MODE=local explicitly.
 *  - "public" (DEFAULT): reads the sanitized `public-snapshot.json`. No SQLite,
 *    no todos, no private data. A deployed public demo, and the fallback for any
 *    unset or unrecognised ATLAS_MODE — see atlasMode() for why.
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

/**
 * Resolve the env mode, defaulting to the LEAST privileged option.
 *
 * This used to default to "local" — the MOST privileged mode, which reads the
 * unsanitized SQLite database. A deployment that simply forgot to set ATLAS_MODE
 * would therefore try to serve owner data, and the only thing standing in its way
 * was `.vercelignore` excluding `data`/`*.db` from the upload. That is fail-safe
 * by accident of a second, unrelated file rather than by design: rename or
 * reorganise `.vercelignore` and a misconfigured deploy starts reading the DB.
 *
 * Defaulting to "public" inverts that. An unset or misspelled ATLAS_MODE now
 * yields the sanitized snapshot, and every consumer fails in the safe direction
 * (roadmap writes refused, feedback/digest/summarize routes disabled, snapshot
 * read instead of SQLite). Local development opts IN explicitly — see the `dev`
 * script in package.json, which sets ATLAS_MODE=local.
 *
 * Note "local" is now an explicit case: an unrecognised value must not silently
 * land on the privileged mode just because it sorts to the default branch.
 */
export function atlasMode(): AtlasMode {
  switch (process.env.ATLAS_MODE) {
    case "local":
      return "local";
    case "owner":
      return "owner";
    case "unified":
      return "unified";
    case "public":
      return "public";
    default:
      return "public";
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

/**
 * The pure form of the per-request mode decision, so the security property can
 * be tested without Next's request context. Owner data is served only when the
 * deployment is "unified" AND the request carries a verified owner session; in
 * every other env mode the result is the env mode itself. Defaults to "public":
 * a missing or unverifiable session can never resolve to "owner".
 */
export function resolveRequestMode(env: AtlasMode, sessionVerified: boolean): ResolvedMode {
  if (env !== "unified") return env;
  return sessionVerified === true ? "owner" : "public";
}

/**
 * Whether the sidebar shows sign-in / sign-out controls. True wherever a session
 * cookie is in play: the unified deployment (public and owner behind one login)
 * and the standalone owner deployment (every route behind the proxy gate). In
 * local and public modes there is nothing to sign in to.
 */
export function authControlsEnabled(env: AtlasMode): boolean {
  return env === "unified" || env === "owner";
}
