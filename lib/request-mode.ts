import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { atlasMode, resolveRequestMode, type ResolvedMode } from "@/lib/mode";
import { SESSION_COOKIE, verifySession } from "@/lib/owner-auth/session";

/**
 * Resolve the data mode for THIS request — the single source of truth for whether
 * a request may see owner (private) data.
 *
 * In "unified" deployment, owner data is served ONLY when the request carries a
 * valid owner session; everyone else gets public data. In every other env mode
 * the result is just the env mode. SECURITY: defaults to "public" — a missing,
 * malformed, or unverifiable session can never resolve to "owner". Every data
 * read threads the value returned here; nothing reads owner data without it.
 *
 * cache() memoizes per request, so the cookie is read and the HMAC verified once
 * even though many queries call this within a single render.
 */
export const getRequestMode = cache(async (): Promise<ResolvedMode> => {
  const env = atlasMode();
  if (env !== "unified") return env; // "local" | "public" | "owner"
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveRequestMode(env, await verifySession(token));
});

/** Convenience: is the current request an authenticated owner? */
export const isOwnerRequest = cache(async (): Promise<boolean> => {
  return (await getRequestMode()) === "owner";
});
