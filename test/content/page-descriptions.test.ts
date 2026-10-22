import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { repoMetadata } from "@/lib/repo-metadata";
import { filesUnder } from "./source-files";

/**
 * Every page carried the root layout's meta description, so search results
 * and link previews described every route with the same sentence, the
 * repository pages included. A section page now describes itself with the
 * subtitle it shows, and a repository page with the repository's own
 * description.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "app");

interface Description {
  /** The description's text, when it is a string or a module-level string constant. */
  value?: string;
  /** The constant the description names, if it names one. */
  constant?: string;
  /** How many times the page uses that constant outside its declaration and the metadata. */
  otherUses?: number;
  /** The page exports generateMetadata instead of metadata. */
  dynamic?: boolean;
}

function readDescription(file: string): Description | null {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const constants = new Map<string, string>();
  let metadataInit: ts.ObjectLiteralExpression | null = null;
  for (const st of sf.statements) {
    const exported =
      ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isFunctionDeclaration(st) && st.name?.text === "generateMetadata") return { dynamic: true };
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      if (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer)) {
        constants.set(d.name.text, d.initializer.text);
      }
      if (exported && d.name.text === "metadata") {
        let init: ts.Expression = d.initializer;
        while (ts.isSatisfiesExpression(init) || ts.isAsExpression(init)) init = init.expression;
        if (ts.isObjectLiteralExpression(init)) metadataInit = init;
      }
    }
  }
  if (!metadataInit) return null;
  const prop = metadataInit.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "description"
  );
  if (!prop || !ts.isPropertyAssignment(prop)) return {};
  const v = prop.initializer;
  if (ts.isStringLiteral(v)) return { value: v.text };
  if (!ts.isIdentifier(v)) return {};
  let otherUses = 0;
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === v.text && n !== v) {
      const declaration = ts.isVariableDeclaration(n.parent) && n.parent.name === n;
      if (!declaration) otherUses++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { value: constants.get(v.text), constant: v.text, otherUses };
}

const layoutDescription = readDescription(join(APP, "layout.tsx"))?.value;
const pages = filesUnder(APP, /^page\.tsx$/);

test("the root layout keeps a site description for the pages that set none", () => {
  assert.ok(layoutDescription, "app/layout.tsx exports metadata with a description");
});

test("every section page describes itself with the text it shows", () => {
  assert.ok(pages.length >= 15, `expected the app's pages, got ${pages.length}`);
  const seen = new Map<string, string>();
  for (const f of pages) {
    const rel = relative(ROOT, f);
    const d = readDescription(f);
    assert.ok(d, `${rel} exports metadata or generateMetadata`);
    if (d.dynamic) continue;
    assert.ok(d.value, `${rel} sets a description in its metadata`);
    assert.notEqual(d.value, layoutDescription, `${rel} has its own description, not the site's`);
    assert.ok(!d.value.includes("—"), `${rel} description has no em dash: ${d.value}`);
    // The description is the page's subtitle (or, on the login page, its
    // lead line): one constant, rendered by the page and named in metadata.
    assert.ok(d.constant && (d.otherUses ?? 0) > 0, `${rel} renders the constant its description names`);
    assert.ok(!seen.has(d.value), `${rel} and ${seen.get(d.value)} share the description "${d.value}"`);
    seen.set(d.value, rel);
  }
  assert.equal(
    readDescription(join(APP, "page.tsx"))?.value,
    "Every project you're building, at a glance."
  );
  assert.equal(
    readDescription(join(APP, "activity", "page.tsx"))?.value,
    "Where your energy went, across every repo."
  );
});

test("a repository page is described by the repository it shows", () => {
  const file = join(APP, "repo", "[slug]", "page.tsx");
  assert.deepEqual(readDescription(file), { dynamic: true });
  assert.match(readFileSync(file, "utf8"), /export async function generateMetadata[\s\S]*?return repoMetadata\(repo\)/);

  assert.deepEqual(repoMetadata({ name: "alpha", description: "A parser for alpha files." }), {
    title: "alpha",
    description: "A parser for alpha files.",
  });
  assert.deepEqual(repoMetadata({ name: "alpha", description: "  A parser.  " }), {
    title: "alpha",
    description: "A parser.",
  });
});

test("a repository without a description keeps the site's, and an unknown one is not found", () => {
  assert.deepEqual(repoMetadata({ name: "alpha", description: null }), { title: "alpha" });
  assert.deepEqual(repoMetadata({ name: "alpha", description: "   " }), { title: "alpha" });
  assert.deepEqual(repoMetadata(null), { title: "Page not found" });
});
