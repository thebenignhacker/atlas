// Client-safe strategy types (no node imports), so presentational components can
// import them without bundling fs. The parser lives in lib/strategy.ts (server).

export type StrategyPriority = "P0" | "P1" | "P2" | "P3" | null;

export const STRATEGY_PRIORITIES: Exclude<StrategyPriority, null>[] = [
  "P0",
  "P1",
  "P2",
  "P3",
];

export interface StrategyTask {
  /** Task text with the `#strategy` tag and priority marker stripped. */
  text: string;
  done: boolean;
  priority: StrategyPriority;
  /** The nearest heading above the task. */
  section: string;
}

export interface StrategySection {
  title: string;
  /** Heading depth (2 = `##`, 3 = `###`). */
  level: number;
  /** First prose paragraph under the heading, if any (context, not a task). */
  blurb: string;
  tasks: StrategyTask[];
  done: number;
  total: number;
}

export interface StrategyDoc {
  /** Slug derived from the file name; stable id for the doc. */
  id: string;
  title: string;
  /** Parsed "Last updated: …" line, verbatim, or null. */
  updated: string | null;
  sections: StrategySection[];
  totalTasks: number;
  doneTasks: number;
  openP0: number;
  openP1: number;
  path: string;
}
