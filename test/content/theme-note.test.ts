import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filesUnder } from "./source-files";

/**
 * Atlas has one theme. globals.css sets `color-scheme: light` and defines no
 * dark palette, so a browser set to dark shows the same light pages, and the
 * one surface that used to turn dark was the framework's default 404 page.
 * The README states that the interface is light only. This keeps that note and
 * the styles in agreement: a dark theme added later fails here until the note
 * is updated with it.
 */

const ROOT = process.cwd();

function stylesAreLightOnly(): boolean {
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  if (!/color-scheme:\s*light\s*;/.test(css)) return false;
  const styled = /\.(tsx?|css)$/;
  for (const f of [...filesUnder(join(ROOT, "app"), styled), ...filesUnder(join(ROOT, "components"), styled)]) {
    const src = readFileSync(f, "utf8");
    // A dark palette needs one of these: a media query, a dark colour scheme,
    // or Tailwind's dark variant on a class.
    if (/prefers-color-scheme:\s*dark|color-scheme:[^;]*\bdark\b|(?:^|[\s"'`])dark:/m.test(src)) return false;
  }
  return true;
}

test("the README's theme note agrees with the styles", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const lightOnly = stylesAreLightOnly();
  const note = /light theme only/i.test(readme);
  assert.equal(
    note,
    lightOnly,
    lightOnly
      ? "the styles are light only: the README says so, so a dark system setting is not mistaken for a defect"
      : "the styles now carry a dark theme: update the README's light-only note"
  );
});
