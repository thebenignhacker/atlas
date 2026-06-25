// Client-safe roadmap types and constants. NO node imports here — this module
// is pulled into the browser bundle by the RoadmapBoard client component. The
// filesystem read/write logic lives in lib/roadmap.ts (server only).

import type { Priority } from "@/lib/types";

export type RoadmapStatus =
  | "blocked"
  | "ready"
  | "in-progress"
  | "in-review"
  | "done";

export const ROADMAP_STATUSES: RoadmapStatus[] = [
  "blocked",
  "ready",
  "in-progress",
  "in-review",
  "done",
];

export interface RoadmapComment {
  date: string;
  text: string;
}

export interface RoadmapLink {
  label: string;
  url: string;
}

export interface RoadmapItem {
  /** Filename without .md — the stable id other items depend on. */
  id: string;
  title: string;
  area: string;
  kind: "code" | "non-code" | "other";
  status: RoadmapStatus;
  priority: Priority | null;
  /** Explicit ordering key (the **Order:** field); falls back to title. */
  order: number;
  /** ids of items that must be done first. */
  dependsOn: string[];
  repos: string[];
  links: RoadmapLink[];
  /** Description body (everything above the ## Log section, fields stripped). */
  body: string;
  comments: RoadmapComment[];
  path: string;
}
