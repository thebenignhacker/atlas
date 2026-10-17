import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Donut } from "@/components/Charts";

/**
 * The donut sat in a ResponsiveContainer, whose first render comes before any
 * measurement and uses recharts' placeholder size of -1 by -1. Recharts warns
 * on that render, "The width(-1) and height(-1) of chart should be greater
 * than 0", once per donut: three times on the portfolio and once on the
 * activity page. The donut's column has a fixed size, so the chart now takes
 * that size directly and its first render already has it. The server render
 * runs the same first render the browser hydrates with.
 */

const DATA = [
  { name: "TypeScript", value: 12, color: "#1f8a7e" },
  { name: "Go", value: 4, color: "#e8a317" },
  { name: "Python", value: 2, color: "#c75d3c" },
];

function renderCapturingWarnings(): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    return { html: renderToStaticMarkup(createElement(Donut, { data: DATA, unit: "repos" })), warnings };
  } finally {
    console.warn = original;
  }
}

test("a donut's first render logs no chart size warning", () => {
  const { warnings } = renderCapturingWarnings();
  assert.deepEqual(warnings, []);
});

test("the donut chart has its column's size on the first render", () => {
  const { html } = renderCapturingWarnings();
  // Inside the ResponsiveContainer the first render held no chart at all: at -1
  // by -1 recharts skips the chart until a measurement arrives.
  const wrapper = html.match(/<div\b[^>]*\bclass="recharts-wrapper"[^>]*>/)?.[0];
  assert.ok(wrapper, `the first render holds the chart; markup: ${html.slice(0, 300)}`);
  assert.match(wrapper, /width:136px;height:150px/);
  // The centred total and the legend still render beside the ring.
  assert.match(html, />18</);
  for (const d of DATA) assert.ok(html.includes(`>${d.name}<`), `legend lists ${d.name}`);
});
