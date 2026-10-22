import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import ts from "typescript";
import { ActivityView } from "@/components/ActivityView";
import { ContextView } from "@/components/ContextView";
import { PortfolioView } from "@/components/PortfolioView";
import type { ContextCard } from "@/lib/types";
import { filesUnder } from "./source-files";

/**
 * The filter selects on the portfolio, context and activity pages had no
 * accessible name, so a screen reader announced each one as an unnamed
 * combobox and voice control had nothing to call it by, and the portfolio
 * search box was named only by its placeholder. The first option ("All orgs")
 * already reads as the visible label, so a select carries an aria-label rather
 * than a visible <label>, and a view's Select helper takes a required `label`
 * prop, so a select without a name no longer type-checks.
 */

const ROOT = process.cwd();
// Input types that take free text; a placeholder on one is a hint, not a name.
const TEXT_TYPES = new Set(["text", "search"]);

type Element = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

interface Source {
  file: string;
  rel: string;
  sf: ts.SourceFile;
  elements: Element[];
}

function parse(file: string, text: string): Source {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: Element[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) elements.push(n);
    n.forEachChild(visit);
  };
  visit(sf);
  return { file, rel: relative(ROOT, file), sf, elements };
}

const sources = [join(ROOT, "components"), join(ROOT, "app")]
  .flatMap((dir) => filesUnder(dir, /\.tsx$/))
  .map((file) => parse(file, readFileSync(file, "utf8")));

const tagOf = (el: Element) => el.tagName.getText();
const at = (s: Source, n: ts.Node) => `${s.rel}:${s.sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
const isExported = (n: ts.Node) =>
  ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

function attr(el: Element, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name
  );
}

/** A constant string attribute's value; undefined when the attribute is absent or computed. */
function constant(a: ts.JsxAttribute | undefined): string | undefined {
  const v = a?.initializer;
  if (v && ts.isStringLiteral(v)) return v.text;
  if (v && ts.isJsxExpression(v) && v.expression && ts.isStringLiteralLike(v.expression)) return v.expression.text;
  return undefined;
}

/** Why `a` does not give its control a usable name, or null when it does. */
function nameProblem(a: ts.JsxAttribute | undefined, name: string): string | null {
  if (!a?.initializer) return `has no ${name}`;
  const v = a.initializer;
  // A computed name (`Status of ${item.title}`) is checked by its constant head, when it has one.
  const text =
    ts.isJsxExpression(v) && v.expression && ts.isTemplateExpression(v.expression)
      ? v.expression.head.text || undefined
      : constant(a);
  if (text === undefined) return null;
  if (!text.trim()) return `has an empty ${name}`;
  if (/\b(select|dropdown)\b/i.test(text)) return `is named "${text}": the role is announced already, leave it out`;
  if (!/^[A-Z]/.test(text)) return `is named "${text}": start it with a capital, in sentence case`;
  if (/(…|\.\.\.)$/.test(text)) return `is named "${text}": a name is not a placeholder, drop the ellipsis`;
  return null;
}

interface Component {
  name: string;
  fn: ts.SignatureDeclaration;
  source: Source;
  exported: boolean;
}

/** The function component a node is rendered by: a named function, or a function assigned to a const. */
function componentOf(s: Source, n: ts.Node): Component | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return { name: p.name.text, fn: p, source: s, exported: isExported(p) };
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name))
      return { name: p.parent.name.text, fn: p, source: s, exported: isExported(p.parent.parent.parent) };
  }
  return undefined;
}

/**
 * The prop that a component destructures into `local`, when its props type
 * declares that prop as a required string; undefined otherwise.
 */
function requiredStringProp(c: Component, local: string): string | undefined {
  const param = c.fn.parameters[0];
  if (!param || !ts.isObjectBindingPattern(param.name)) return undefined;
  const binding = param.name.elements.find((e) => ts.isIdentifier(e.name) && e.name.text === local);
  if (!binding || binding.initializer || binding.dotDotDotToken) return undefined;
  const prop = binding.propertyName?.getText() ?? local;
  let members: ts.NodeArray<ts.TypeElement> | undefined;
  const t = param.type;
  if (t && ts.isTypeLiteralNode(t)) members = t.members;
  else if (t && ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const ref = t.typeName.text;
    for (const st of c.source.sf.statements) {
      if (ts.isInterfaceDeclaration(st) && st.name.text === ref) members = st.members;
      if (ts.isTypeAliasDeclaration(st) && st.name.text === ref && ts.isTypeLiteralNode(st.type)) members = st.type.members;
    }
  }
  const sig = members?.find((m): m is ts.PropertySignature => ts.isPropertySignature(m) && m.name.getText() === prop);
  return sig && !sig.questionToken && sig.type?.kind === ts.SyntaxKind.StringKeyword ? prop : undefined;
}

/** Whether `s` imports `name` from the module at `target`. */
function importsFrom(s: Source, name: string, target: string): boolean {
  return s.sf.statements.some((st) => {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) return false;
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || !named.elements.some((e) => !e.propertyName && e.name.text === name)) return false;
    const spec = st.moduleSpecifier.text;
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(s.file), spec) : null;
    return !!base && [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx")].includes(target);
  });
}

/** Every place a component is rendered: in its own file, or in files that import it. */
function usesOf(c: Component, all: Source[]): { s: Source; el: Element }[] {
  return all
    .filter((s) => s === c.source || (c.exported && importsFrom(s, c.name, c.source.file)))
    .flatMap((s) => s.elements.filter((el) => tagOf(el) === c.name).map((el) => ({ s, el })));
}

/** Every <select> without a usable name, and how many selects there are. */
function selectProblems(all: Source[]): { count: number; problems: string[] } {
  const problems: string[] = [];
  let count = 0;
  for (const s of all) {
    for (const el of s.elements) {
      if (tagOf(el) !== "select") continue;
      count++;
      const a = attr(el, "aria-label");
      const v = a?.initializer;
      if (v && ts.isJsxExpression(v) && v.expression && ts.isIdentifier(v.expression)) {
        // A helper's <select aria-label={label}>: the prop is required, and every use names it.
        const c = componentOf(s, el);
        const prop = c && requiredStringProp(c, v.expression.text);
        if (!c || !prop) {
          problems.push(`${at(s, el)} <select aria-label={${v.expression.text}}> forwards something other than a required string prop`);
          continue;
        }
        const uses = usesOf(c, all);
        if (uses.length === 0) problems.push(`${at(s, el)} <${c.name}> is never rendered, so its names cannot be checked`);
        for (const u of uses) {
          const p = nameProblem(attr(u.el, prop), prop);
          if (p) problems.push(`${at(u.s, u.el)} <${c.name}> ${p}`);
        }
        continue;
      }
      const p = nameProblem(a, "aria-label");
      if (p) problems.push(`${at(s, el)} <select> ${p}`);
    }
  }
  return { count, problems };
}

/** Every free-text <input> with a placeholder and no usable name, and how many there are. */
function inputProblems(all: Source[]): { count: number; problems: string[] } {
  const problems: string[] = [];
  let count = 0;
  for (const s of all) {
    const labelled = new Set(s.elements.filter((el) => tagOf(el) === "label").map((el) => constant(attr(el, "htmlFor"))));
    for (const el of s.elements) {
      if (tagOf(el) !== "input" || !attr(el, "placeholder")) continue;
      const type = attr(el, "type");
      const kind = constant(type);
      if (type && kind !== undefined && !TEXT_TYPES.has(kind)) continue;
      count++;
      const id = constant(attr(el, "id"));
      if (id !== undefined && labelled.has(id)) continue;
      const p = nameProblem(attr(el, "aria-label"), "aria-label");
      if (p) problems.push(`${at(s, el)} <input placeholder=…> ${p}, and no <label htmlFor> names it`);
    }
  }
  return { count, problems };
}

test("every select has an accessible name", () => {
  const { count, problems } = selectProblems(sources);
  assert.ok(count >= 3, `expected the filter selects of the views, found ${count}`);
  assert.deepEqual(problems, []);
});

test("every text input with a placeholder has an accessible name", () => {
  const { count, problems } = inputProblems(sources);
  assert.ok(count >= 1, `expected the portfolio search box, found ${count} text inputs with a placeholder`);
  assert.deepEqual(problems, []);
});

const fixture = (rel: string, lines: string[]) => parse(join(ROOT, rel), lines.join("\n"));
const withoutPlace = (problems: string[]) => problems.map((p) => p.replace(/^\S+:\d+ /, ""));
const pick = fixture("components/Pick.tsx", [
  "export function Pick({ label, value }: { label: string; value: string }) {",
  "  return <select aria-label={label} value={value} />;",
  "}",
]);

test("the checks flag a select or a text input without a usable name", () => {
  const bad = fixture("components/Bad.tsx", [
    "function Maybe({ label }: { label?: string }) {",
    "  return <select aria-label={label} />;",
    "}",
    "function Choose({ name }: { name: string }) {",
    "  return <select aria-label={name} />;",
    "}",
    "function Unused({ label }: { label: string }) {",
    "  return <select aria-label={label} />;",
    "}",
    "export function Bad() {",
    "  return (",
    "    <div>",
    '      <Maybe />',
    '      <Choose name="Select a repository" />',
    '      <select value="b" />',
    '      <select aria-label="" />',
    '      <select aria-label="filter by org" />',
    '      <input placeholder="Search…" />',
    '      <input type="search" placeholder="Find…" aria-label="Find…" />',
    '      <input id="q" placeholder="Query" />',
    "    </div>",
    "  );",
    "}",
  ]);
  const page = fixture("app/bad/page.tsx", [
    'import { Pick } from "@/components/Pick";',
    "export default function Page() {",
    '  return <Pick label="Select an area" value="all" />;',
    "}",
  ]);
  const selects = selectProblems([pick, bad, page]);
  assert.deepEqual(selects.problems, [
    'app/bad/page.tsx:3 <Pick> is named "Select an area": the role is announced already, leave it out',
    "components/Bad.tsx:2 <select aria-label={label}> forwards something other than a required string prop",
    'components/Bad.tsx:14 <Choose> is named "Select a repository": the role is announced already, leave it out',
    "components/Bad.tsx:8 <Unused> is never rendered, so its names cannot be checked",
    "components/Bad.tsx:15 <select> has no aria-label",
    "components/Bad.tsx:16 <select> has an empty aria-label",
    'components/Bad.tsx:17 <select> is named "filter by org": start it with a capital, in sentence case',
  ]);
  assert.deepEqual(withoutPlace(inputProblems([bad]).problems), [
    "<input placeholder=…> has no aria-label, and no <label htmlFor> names it",
    '<input placeholder=…> is named "Find…": a name is not a placeholder, drop the ellipsis, and no <label htmlFor> names it',
    "<input placeholder=…> has no aria-label, and no <label htmlFor> names it",
  ]);
});

test("the checks accept a forwarded required label, a computed name and a <label htmlFor>", () => {
  const page = fixture("app/good/page.tsx", [
    'import { Pick } from "@/components/Pick";',
    "export default function Page({ items }: { items: { title: string }[] }) {",
    "  return (",
    "    <form>",
    '      <Pick label="Filter by area" value="all" />',
    "      {items.map((item) => (",
    "        <select key={item.title} aria-label={`Status of ${item.title}`} />",
    "      ))}",
    "      <select aria-label={`${items[0].title} owner`} />",
    '      <label htmlFor="q">Query</label>',
    '      <input id="q" placeholder="Search…" />',
    '      <input type="password" placeholder="Password" />',
    "    </form>",
    "  );",
    "}",
  ]);
  assert.deepEqual(selectProblems([pick, page]), { count: 3, problems: [] });
  assert.deepEqual(inputProblems([page]), { count: 1, problems: [] });
});

/** The aria-label of each <select> in rendered markup, null where a select has none. */
const selectNames = (html: string) =>
  (html.match(/<select\b[^>]*>/g) ?? []).map((tag) => tag.match(/\saria-label="([^"]*)"/)?.[1] ?? null);
const classesOf = (tag: string) => tag.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};
const portfolio = () =>
  renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router }, createElement(PortfolioView, { repos: [] }))
  );

test("the portfolio view renders its search box and filters with names", () => {
  const html = portfolio();
  assert.deepEqual(selectNames(html), [
    "Filter by organisation",
    "Filter by language",
    "Filter by freshness",
    "Filter by visibility",
    "Sort repositories",
  ]);
  const search = html.match(/<input\b[^>]*placeholder="Search repos…"[^>]*>/)?.[0];
  assert.ok(search, `the portfolio renders its search box; markup: ${html.slice(0, 400)}`);
  assert.match(search, /\saria-label="Search repositories"/);
});

/**
 * On a phone the filters sit two to a row, 135.5px each at 375px wide. With
 * 12px padding "Any freshness" needed 137px and "Recent activity" 142px, so the
 * sort select showed "Recent activit". The sort select is alone on the last
 * row, so it takes all of it, and the filters use 10px padding below the `sm`
 * breakpoint.
 */
test("on a phone the sort select has its row to itself and the filters use the narrower padding", () => {
  // Each select's markup up to its closing tag, so a select can be found by its options.
  const selects = portfolio().match(/<select\b[\s\S]*?<\/select>/g) ?? [];
  assert.equal(selects.length, 5);
  const sort = selects.find((s) => s.includes(">Recent activity</option>"));
  assert.ok(sort, "the portfolio renders its sort select");
  const sortClasses = classesOf(sort.slice(0, sort.indexOf(">")));
  assert.ok(sortClasses.includes("col-span-2"), `the sort select spans the phone grid's row: ${sortClasses.join(" ")}`);
  for (const s of selects) {
    const c = classesOf(s.slice(0, s.indexOf(">")));
    assert.ok(c.includes("px-2.5") && c.includes("sm:px-3"), `a filter keeps 10px padding on a phone and 12px above it: ${c.join(" ")}`);
  }
});

test("the activity view renders its repository filter with a name", () => {
  const html = renderToStaticMarkup(createElement(ActivityView, { events: [], repoMap: {} }));
  assert.deepEqual(selectNames(html), ["Filter by repository"]);
});

const card: ContextCard = {
  id: "atlas:filters",
  project: "atlas",
  repoSlug: null,
  subject: "filters",
  claim: "c",
  detail: null,
  provenance: [],
  verifyCommand: null,
  verifyResult: null,
  verifyCheckedAt: null,
  confidence: "medium",
  derivedAt: "2026-01-01T00:00:00.000Z",
  lastVerifiedAt: "2026-01-01T00:00:00.000Z",
  staleAfterDays: null,
  freshness: "fresh",
  driftedPaths: [],
  tags: [],
  links: [],
  status: "active",
  supersededBy: null,
  visibility: "public",
  sensitive: false,
  originSessionId: null,
  createdAt: null,
  updatedAt: null,
};

test("the context view renders its project and state filters with names", () => {
  // With no cards the view shows its empty state, which has no filters, so it gets one.
  const html = renderToStaticMarkup(createElement(ContextView, { cards: [card] }));
  assert.deepEqual(selectNames(html), ["Filter by project", "Filter by state"]);
});
