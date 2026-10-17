import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { filesUnder } from "./source-files";

/**
 * The content standard punctuates Atlas's own copy with a colon, a comma or a
 * full stop, never an em dash. The tab title, the /context and /usage
 * subtitles, the "when to use" lines and the freshness labels all used one.
 *
 * This reads every string, template and JSX text in app/, components/ and the
 * library modules whose strings are shown on a page, and fails on an em dash.
 * Comments are not copy and are not read. The dash on its own, as a whole
 * string or as the only text of an element, is the empty-value marker in
 * tables and fact rows, and stays; a dash between other text, such as the
 * " — " before each "when to use" line, is punctuation and does not.
 * Repository descriptions are GitHub data and never pass through these files.
 */

const ROOT = process.cwd();
const EM_DASH = "—";

/** Library modules whose strings render on a page. */
const LIB_COPY = [
  "lib/freshness-shared.ts", // the freshness line under each page header
  "lib/usage/catalog-meta.ts", // feature descriptions and "when to use" on /usage
  "lib/usage/scaffold.ts", // automation scaffolds on /usage
  "lib/ai/policy.ts", // why a repository is left out of AI, on its page
];

/** The empty-value marker: a string that is only the dash, or an element whose only text is the dash. */
function isEmptyValueMarker(node: ts.Node, text: string): boolean {
  if (ts.isStringLiteral(node)) return text === EM_DASH;
  if (!ts.isJsxText(node) || text.trim() !== EM_DASH || !ts.isJsxElement(node.parent)) return false;
  return node.parent.children.every((c) => c === node || (ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces));
}

/** `file:line: text` for each string, template part or JSX text with an em dash. */
function emDashCopy(fileName: string, src: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    )
      text = node.text;
    if (text !== null && text.includes(EM_DASH) && !isEmptyValueMarker(node, text)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      hits.push(`${fileName}:${line}: ${text.trim().replace(/\s+/g, " ").slice(0, 90)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

test("the scan reads strings, templates and JSX text, and skips comments and the empty-value marker", () => {
  const src = [
    `// a comment ${EM_DASH} not copy`,
    `const a = "plain ${EM_DASH} string";`,
    "const b = `head " + EM_DASH + " ${a} middle " + EM_DASH + " ${a} tail " + EM_DASH + "`;",
    `const c = <p title="attribute ${EM_DASH} value">text ${EM_DASH} node {/* jsx comment ${EM_DASH} */}</p>;`,
    `const d = a ?? "${EM_DASH}";`,
    `const e = <td>${EM_DASH}</td>;`,
    `const f = <span> ${EM_DASH} {a}</span>;`,
    `const g = " ${EM_DASH} ";`,
  ].join("\n");
  const hits = emDashCopy("fixture.tsx", src);
  assert.deepEqual(
    hits.map((h) => h.split(": ")[1]),
    [
      `plain ${EM_DASH} string`,
      `head ${EM_DASH}`,
      `middle ${EM_DASH}`,
      `tail ${EM_DASH}`,
      `attribute ${EM_DASH} value`,
      `text ${EM_DASH} node`,
      EM_DASH,
      EM_DASH,
    ]
  );
});

test("the site's own copy uses no em dash", () => {
  const files = [
    ...filesUnder(join(ROOT, "app"), /\.tsx?$/),
    ...filesUnder(join(ROOT, "components"), /\.tsx?$/),
    ...LIB_COPY.map((f) => join(ROOT, f)),
  ];
  assert.ok(files.length >= 40, `expected the app, components and copy modules, got ${files.length} files`);
  const hits = files.flatMap((f) => emDashCopy(relative(ROOT, f), readFileSync(f, "utf8")));
  assert.deepEqual(hits, [], `copy with an em dash (use a colon, a comma or a full stop):\n${hits.join("\n")}`);
});
