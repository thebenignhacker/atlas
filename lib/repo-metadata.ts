import type { Metadata } from "next";

/**
 * A repository page's tab title and description: the repository's name and
 * its own description. A repository without a description keeps the root
 * layout's description. An unknown slug renders the not-found page, and the
 * title says so.
 */
export function repoMetadata(
  repo: { name: string; description: string | null } | null
): Metadata {
  if (!repo) return { title: "Page not found" };
  const description = repo.description?.trim();
  return description ? { title: repo.name, description } : { title: repo.name };
}
