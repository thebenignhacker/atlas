import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AtlasStats, RepoWithSignals } from "@/lib/queries";
import type { ResolvedMode } from "@/lib/mode";
import { PortfolioStats } from "@/components/PortfolioStats";
import { PortfolioView } from "@/components/PortfolioView";
import { inAppRouter } from "../app-router";

/**
 * The public snapshot holds only public repos that are not forks, and no
 * todos. In the public view the "Private", "Forks" and "Open P0" tiles read 0
 * whatever the portfolio held, the "Private" visibility option and the "Has
 * todos" toggle matched no repo, and the visibility filter could not narrow
 * the list. The public view leaves them out; the local and owner views keep
 * them.
 */

const STATS: AtlasStats = {
  lastScanAt: "2026-10-01T00:00:00.000Z",
  repoCount: 9,
  todoCount: 4,
  activityCount: 20,
  publicCount: 5,
  privateCount: 3,
  forkCount: 1,
  needsAttention: 2,
  openP0: 1,
};

const ALL_TILES = ["Repos", "Public", "Private", "Forks", "Need attention", "Open P0"];
const PUBLIC_TILES = ["Repos", "Public", "Need attention"];

function strip(mode: ResolvedMode): string {
  return renderToStaticMarkup(createElement(PortfolioStats, { stats: STATS, mode }));
}

/** The tile labels, in order. */
function tileLabels(html: string): string[] {
  return [...html.matchAll(/<div class="mt-1\.5 [^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);
}

/** The class list of a markup slice's first tag, with the entities decoded. */
function classesOf(markup: string): string[] {
  const attr = markup.match(/^<[^>]*?\sclass="([^"]*)"/)?.[1] ?? "";
  return attr.replace(/&gt;/g, ">").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);
}

test("the public view's stat strip leaves out the tiles its snapshot cannot fill", () => {
  assert.deepEqual(tileLabels(strip("public")), PUBLIC_TILES);
});

test("the local and owner views keep every stat tile", () => {
  for (const mode of ["local", "owner"] as const) {
    assert.deepEqual(tileLabels(strip(mode)), ALL_TILES, `${mode} view`);
  }
});

test("three tiles fill their row instead of half of a six-column grid", () => {
  const three = classesOf(strip("public"));
  assert.ok(three.includes("sm:grid-cols-3"), `three columns from sm: ${three.join(" ")}`);
  assert.ok(!three.includes("lg:grid-cols-6"), `no six-column row: ${three.join(" ")}`);
  // On a phone's two columns the third tile spans the second row.
  assert.ok(three.includes("[&>:last-child]:col-span-2"), three.join(" "));
  assert.ok(three.includes("sm:[&>:last-child]:col-span-1"), three.join(" "));

  const six = classesOf(strip("local"));
  for (const c of ["grid-cols-2", "sm:grid-cols-3", "lg:grid-cols-6"]) {
    assert.ok(six.includes(c), `six tiles keep ${c}: ${six.join(" ")}`);
  }
  assert.ok(!six.some((c) => c.includes("col-span")), six.join(" "));
});

function repo(slug: string, over: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    slug,
    name: slug,
    path: `/repos/${slug}`,
    groupName: "example-org",
    remoteUrl: null,
    owner: "example-org",
    repoName: slug,
    branch: "main",
    lastCommitAt: "2026-10-01T00:00:00.000Z",
    lastCommitSha: null,
    lastCommitMsg: null,
    commitCount30d: 2,
    dirty: 0,
    ahead: 0,
    behind: 0,
    visibility: "public",
    isFork: 0,
    isArchived: 0,
    language: "TypeScript",
    stars: 0,
    openIssues: 0,
    openPrs: 0,
    defaultBranch: "main",
    pushedAt: null,
    description: null,
    scannedAt: "2026-10-01T00:00:00.000Z",
    signals: { staleness: "recent", daysSinceCommit: 3, attention: [] },
    openTodos: 0,
    ...over,
  };
}

function view(publicView: boolean, repos: RepoWithSignals[]): string {
  return renderToStaticMarkup(inAppRouter(createElement(PortfolioView, { repos, publicView })));
}

test("the public view's filter bar has no visibility filter and no todos toggle", () => {
  const html = view(true, [repo("alpha"), repo("beta")]);
  assert.ok(!html.includes('value="private"'), "no Private option");
  assert.ok(!html.includes("All visibility"), "no visibility filter");
  assert.ok(!html.includes("Has todos"), "no Has todos toggle");
  // The filters the public snapshot can populate stay.
  for (const kept of ["All orgs", "All languages", "Any freshness", "Needs attention", "Group by org"]) {
    assert.ok(html.includes(kept), `keeps ${kept}`);
  }
});

test("the local and owner views keep the visibility filter and the todos toggle", () => {
  const html = view(false, [
    repo("alpha"),
    repo("beta", { visibility: "private", openTodos: 2 }),
  ]);
  assert.ok(html.includes('<option value="private">Private</option>'), "Private option");
  assert.ok(html.includes("All visibility"), "visibility filter");
  assert.ok(html.includes("Has todos"), "Has todos toggle");
});

/**
 * On a phone the filter bar is a two-column grid: the search box and the sort
 * select take a row each ("Recent activity" does not fit in half of one) and
 * the filters between them pair up. Without the visibility filter the public
 * view has three filters, and the freshness filter sat in the left half of its
 * row with the right half empty. CSS lays the grid out, so these tests place
 * its cells the way the grid's default auto-placement does, from the classes
 * in the rendered markup.
 */

const EMPTY = "(empty)";
const VOID_TAGS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The markup of each direct child of the element whose opening tag starts at `start`. */
function childrenAt(html: string, start: number): string[] {
  const tag = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  tag.lastIndex = start;
  const children: string[] = [];
  let depth = 0;
  let childStart = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    const [whole, closing, name, selfClosing] = m;
    if (closing) {
      depth -= 1;
      if (depth === 1) children.push(html.slice(childStart, m.index + whole.length));
      if (depth === 0) return children;
    } else if (selfClosing || VOID_TAGS.has(name)) {
      if (depth === 1) children.push(whole);
    } else {
      if (depth === 1) childStart = m.index;
      depth += 1;
    }
  }
  throw new Error(`the element at offset ${start} does not close`);
}

function nthMatches(arg: string, position: number): boolean {
  if (arg === "even") return position % 2 === 0;
  if (arg === "odd") return position % 2 === 1;
  if (/^\d+$/.test(arg)) return position === Number(arg);
  throw new Error(`the grid model does not read (${arg})`);
}

/** Whether the child at 1-based `index` of `count` siblings matches every pseudo-class in `chain`. */
function chainMatches(chain: string, index: number, count: number): boolean {
  const parts = chain.match(/:[a-z-]+(?:\([^)]*\))?/g) ?? [];
  if (parts.join("") !== chain) throw new Error(`the grid model does not read ${chain}`);
  return parts.every((part) => {
    const [, name, arg = ""] = part.match(/^:([a-z-]+)(?:\(([^)]*)\))?$/) ?? [];
    switch (name) {
      case "first-child":
        return index === 1;
      case "last-child":
        return index === count;
      case "nth-child":
        return nthMatches(arg, index);
      case "nth-last-child":
        return nthMatches(arg, count - index + 1);
      default:
        throw new Error(`the grid model does not read ${part}`);
    }
  });
}

/**
 * How many of the two columns each cell spans: two when it carries `col-span-2`
 * or matches one of the grid's `[&>…]:col-span-2` rules. A class behind a
 * breakpoint (`sm:`) does not apply on a phone.
 */
function spans(gridClasses: string[], cells: string[]): number[] {
  const rules = gridClasses.filter((c) => c.startsWith("[&") && /\]:col-span-[^\]]*$/.test(c));
  return cells.map((cell, i) => {
    let span = 1;
    for (const c of classesOf(cell)) {
      if (c === "col-span-2") span = 2;
      else if (c.startsWith("col-span-")) throw new Error(`the grid model does not read ${c}`);
    }
    for (const rule of rules) {
      const chain = rule.match(/^\[&>((?::[a-z-]+(?:\([^)]*\))?)+)\]:col-span-2$/)?.[1];
      if (!chain) throw new Error(`the grid model does not read ${rule}`);
      if (chainMatches(chain, i + 1, cells.length)) span = 2;
    }
    return span;
  });
}

/**
 * The filter grid's rows on a phone, each as the names of its cells and EMPTY
 * for a cell left blank. Auto-placement fills a row left to right and moves a
 * cell that does not fit beside the ones before it to the next row.
 */
function phoneRows(html: string): string[][] {
  const reposAt = html.search(/<div\b[^>]*\sid="repos"/);
  assert.ok(reposAt >= 0, "the view renders its #repos filter bar");
  const [grid] = childrenAt(html, reposAt);
  const gridClasses = classesOf(grid);
  assert.ok(
    gridClasses.includes("grid") && gridClasses.includes("grid-cols-2"),
    `the filters are a two-column grid on a phone: ${gridClasses.join(" ")}`
  );
  const cells = childrenAt(grid, 0);
  const widths = spans(gridClasses, cells);
  const rows: string[][] = [];
  let row: string[] = [];
  let used = 0;
  const endRow = () => {
    for (; used < 2; used += 1) row.push(EMPTY);
    rows.push(row);
    row = [];
    used = 0;
  };
  cells.forEach((cell, i) => {
    if (used + widths[i] > 2) endRow();
    row.push(cell.match(/\saria-label="([^"]*)"/)?.[1] ?? "(unnamed)");
    used += widths[i];
    if (used === 2) endRow();
  });
  if (row.length > 0) endRow();
  return rows;
}

test("the phone grid model leaves a cell empty beside a filter with no partner", () => {
  const bar = (rule: string, sort: string) =>
    `<div id="repos"><div class="grid grid-cols-2 ${rule}">` +
    '<div class="col-span-2"><input aria-label="Search"/></div>' +
    '<select aria-label="A"></select><select aria-label="B"></select><select aria-label="C"></select>' +
    `${sort}</div><div class="flex"></div></div>`;
  // The public filter bar as it was: the rule widens a last child at an even
  // position, and the full-width sort select is the last child, at an odd one.
  const lastChildRule = "[&amp;&gt;:last-child:nth-child(even)]:col-span-2";
  assert.deepEqual(phoneRows(bar(lastChildRule, '<select aria-label="Sort" class="col-span-2"></select>')), [
    ["Search"],
    ["A", "B"],
    ["C", EMPTY],
    ["Sort"],
  ]);
  // Without the sort select the rule reaches C, the last child.
  assert.deepEqual(phoneRows(bar(lastChildRule, "")), [["Search"], ["A", "B"], ["C"]]);
});

test("on a phone the public view's filters fill their rows, with no cell left empty", () => {
  assert.deepEqual(phoneRows(view(true, [repo("alpha"), repo("beta")])), [
    ["Search repositories"],
    ["Filter by organisation", "Filter by language"],
    ["Filter by freshness"],
    ["Sort repositories"],
  ]);
});

test("on a phone the local and owner views keep their filters two to a row", () => {
  assert.deepEqual(phoneRows(view(false, [repo("alpha")])), [
    ["Search repositories"],
    ["Filter by organisation", "Filter by language"],
    ["Filter by freshness", "Filter by visibility"],
    ["Sort repositories"],
  ]);
});
