import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RankBar } from "@/components/Charts";

/**
 * The ranking panels ("Most active", "By workspace", "Most active repos") used a
 * fixed-width category axis, so a long repository name was cut from the left and
 * four repositories that share a prefix read the same. Each name now renders as
 * text the panel can wrap, never clip.
 */

const DATA = [
  { name: "agent-identity-management-201", value: 49 },
  { name: "agent-identity-management-xnet", value: 52 },
  { name: "opena2a", value: 56 },
  { name: "agent-identity-management", value: 64 },
  { name: "agent-identity-management-telemetry", value: 71 },
  { name: "agent-identity-management-ux", value: 72 },
  { name: "hackmyagent", value: 108 },
];

const CLIPPING = ["truncate", "text-ellipsis", "overflow-hidden", "whitespace-nowrap", "text-nowrap"];

function rows(html: string): string[] {
  const list = html.match(/<ol\b[^>]*>([\s\S]*)<\/ol>/)?.[1];
  assert.ok(list, `the ranking renders an ordered list; markup: ${html.slice(0, 200)}`);
  return list.split(/<li\b/).slice(1);
}

test("every ranked name renders in full, in data order, with its value", () => {
  const html = renderToStaticMarkup(createElement(RankBar, { data: DATA, unit: "commits", fill: "#e8a317" }));
  const items = rows(html);
  assert.equal(items.length, DATA.length, "one row per datum");

  items.forEach((item, i) => {
    const label = item.match(/<div\b([^>]*)>([^<]*)<\/div>/);
    assert.ok(label, `row ${i + 1} has a name element`);
    assert.equal(label[2], DATA[i].name, `row ${i + 1} shows the whole name`);
    const classes = label[1].match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    for (const c of CLIPPING)
      assert.ok(!classes.includes(c), `row ${i + 1} name has no clipping class "${c}"; its classes are: ${classes.join(" ")}`);
    assert.ok(item.includes(`>${DATA[i].value}<`), `row ${i + 1} shows its value ${DATA[i].value}`);
  });
});

test("each datum's own fill colours its bar, and the largest value spans the track", () => {
  const html = renderToStaticMarkup(
    createElement(RankBar, {
      data: [
        { name: "workspace", value: 1 },
        { name: "opena2a-org", value: 52, fill: "#1f8a7e" },
      ],
      unit: "repos",
      fill: "#c75d3c",
    })
  );
  const [small, large] = rows(html);
  assert.match(small, /background:#c75d3c/);
  assert.match(large, /background:#1f8a7e/);
  assert.match(large, /width:100%/);
});

test("an empty ranking keeps the empty state", () => {
  const html = renderToStaticMarkup(createElement(RankBar, { data: [], unit: "repos", fill: "#c75d3c" }));
  assert.match(html, /Not enough data yet\./);
});
