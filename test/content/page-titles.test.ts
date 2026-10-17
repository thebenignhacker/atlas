import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { filesUnder } from "./source-files";

/**
 * Every page had the same tab title, "Atlas — your build, at a glance", so tabs
 * and history entries could not be told apart. The root layout now sets a
 * "%s · Atlas" template and each page names itself.
 *
 * Next.js applies a layout's title template to the routes below it, the
 * not-found page included, but not to the page in the layout's own folder: on
 * the pinned version, `title: "Page not found"` in app/not-found.tsx renders as
 * "Page not found · Atlas", while app/page.tsx gets its title as written, so
 * the portfolio alone states the whole title as `absolute`.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "app");

interface Title {
  text?: string;
  absolute?: string;
  template?: string;
  default?: string;
  dynamic?: boolean;
}

/** The exported `metadata.title`, or `{ dynamic }` for a `generateMetadata` export. */
function readTitle(file: string): Title | null {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const st of sf.statements) {
    const exported =
      ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(st) && st.name?.text === "generateMetadata") return { dynamic: true };
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== "metadata" || !d.initializer) continue;
      let init: ts.Expression = d.initializer;
      while (ts.isSatisfiesExpression(init) || ts.isAsExpression(init)) init = init.expression;
      if (!ts.isObjectLiteralExpression(init)) return null;
      const prop = init.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "title");
      if (!prop || !ts.isPropertyAssignment(prop)) return null;
      const v = prop.initializer;
      if (ts.isStringLiteral(v)) return { text: v.text };
      if (!ts.isObjectLiteralExpression(v)) return null;
      const out: Title = {};
      for (const p of v.properties)
        if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer))
          out[p.name.getText(sf) as "absolute" | "template" | "default"] = p.initializer.text;
      return out;
    }
  }
  return null;
}

const rootTitle = readTitle(join(APP, "layout.tsx"));
const routeFiles = filesUnder(APP, /^(page|not-found)\.tsx$/).filter(
  (f) => /\/page\.tsx$/.test(f) || f === join(APP, "not-found.tsx")
);

test("the root layout sets the title template and a default without an em dash", () => {
  assert.ok(rootTitle, "app/layout.tsx exports metadata with a title");
  assert.equal(rootTitle.template, "%s · Atlas");
  assert.ok(rootTitle.default, "a template needs a default title");
  assert.match(rootTitle.default, /^Atlas\b/);
  assert.ok(!rootTitle.default.includes("—"), `default title has no em dash: ${rootTitle.default}`);
});

test("every page and the not-found page has its own tab title", () => {
  assert.ok(routeFiles.length >= 15, `expected the app's pages, got ${routeFiles.length}`);
  const titles = new Map<string, string>();
  for (const f of routeFiles) {
    const rel = relative(ROOT, f);
    const t = readTitle(f);
    assert.ok(t, `${rel} exports metadata with a title, or generateMetadata`);
    if (t.dynamic) continue;
    let resolved: string | undefined;
    if (f === join(APP, "page.tsx")) {
      assert.ok(t.absolute, `${rel} is the page in the root layout's own folder, which the template does not reach: use title.absolute`);
      resolved = t.absolute;
    } else {
      resolved = t.absolute ?? (t.text !== undefined ? rootTitle?.template?.replace("%s", t.text) : undefined);
    }
    assert.ok(resolved, `${rel} resolves to a title`);
    assert.match(resolved, / · Atlas$/, `${rel} title ends with the site name: ${resolved}`);
    assert.ok(!resolved.includes("—"), `${rel} title has no em dash: ${resolved}`);
    titles.set(rel, resolved);
  }
  const seen = new Map<string, string>();
  for (const [rel, t] of titles) {
    assert.ok(!seen.has(t), `${rel} and ${seen.get(t)} share the title "${t}"`);
    seen.set(t, rel);
  }
  assert.equal(titles.get("app/page.tsx"), "Portfolio · Atlas");
  assert.equal(titles.get("app/not-found.tsx"), "Page not found · Atlas");
  assert.equal(titles.get("app/activity/page.tsx"), "Activity · Atlas");
});

test("a repository page is titled by the repository it shows", () => {
  const file = join(APP, "repo", "[slug]", "page.tsx");
  assert.deepEqual(readTitle(file), { dynamic: true });
  // The title comes from the same lookup the page renders.
  assert.match(readFileSync(file, "utf8"), /export async function generateMetadata[\s\S]*?getRepo\(mode, slug\)/);
});
