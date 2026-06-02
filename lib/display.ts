import type { StalenessBucket } from "@/lib/types";

// Client-safe display constants (no server imports). Colors map to globals.css.

export const STALENESS: Record<
  StalenessBucket,
  { label: string; dot: string; text: string }
> = {
  fresh: { label: "Active today", dot: "bg-fresh", text: "text-fresh" },
  recent: { label: "This week", dot: "bg-recent", text: "text-recent" },
  aging: { label: "This month", dot: "bg-aging", text: "text-aging" },
  stale: { label: "Stale", dot: "bg-stale", text: "text-stale" },
  dormant: { label: "Dormant", dot: "bg-dormant", text: "text-dormant" },
};

// GitHub-ish language colors. Fallback to faint when unknown.
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Go: "#00add8",
  Python: "#3572a5",
  Rust: "#dea584",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Ruby: "#701516",
  Java: "#b07219",
  C: "#555555",
  "C++": "#f34b7d",
  Solidity: "#aa6746",
  Dockerfile: "#384d54",
  MDX: "#fcb32c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
};

export function languageColor(lang: string | null): string {
  if (!lang) return "#6b7484";
  return LANGUAGE_COLORS[lang] ?? "#9aa4b2";
}

export const PRIORITY: Record<string, { text: string; bg: string; label: string }> = {
  P0: { text: "text-rose", bg: "bg-rose/15", label: "P0" },
  P1: { text: "text-amber", bg: "bg-amber/15", label: "P1" },
  P2: { text: "text-teal", bg: "bg-teal/15", label: "P2" },
  P3: { text: "text-faint", bg: "bg-faint/15", label: "P3" },
};
