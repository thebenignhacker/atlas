import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pie, PieChart } from "recharts";
import { Donut } from "@/components/Charts";

/**
 * Each donut put two unnamed stops in the keyboard order: by default recharts
 * gives a chart's svg `tabindex="0" role="application"` (its accessibility
 * layer) and a pie's layer `tabindex="0"`. The portfolio draws three donuts
 * above its search box. The legend names every slice with its value, so the
 * ring is decorative: the donut turns both stops off and hides the ring from
 * assistive technology.
 *
 * Recharts draws the svg only in the browser, so the server render cannot
 * show those attributes. These tests read the props the donut hands recharts,
 * and the markup around the chart.
 */

const DATA = [
  { name: "TypeScript", value: 12, color: "#1f8a7e" },
  { name: "Go", value: 4, color: "#e8a317" },
];

type Props = Record<string, unknown> & { children?: ReactNode };

/** The first element of `type` in a tree of elements, depth first. */
function find(node: ReactNode, type: unknown): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<Props>(node)) return null;
  if (node.type === type) return node;
  return find(node.props.children, type);
}

test("the donut's chart has no accessibility layer and its pie no tab stop", () => {
  const chart = find(Donut({ data: DATA, unit: "repos" }), PieChart);
  assert.ok(chart, "the donut draws a PieChart");
  assert.equal(chart.props.accessibilityLayer, false);
  const pie = find(chart.props.children, Pie);
  assert.ok(pie, "the chart holds a Pie");
  assert.equal(pie.props.rootTabIndex, -1);
});

test("the ring is hidden from assistive technology and the legend is not", () => {
  const html = renderToStaticMarkup(createElement(Donut, { data: DATA, unit: "repos" }));
  // The hidden wrapper holds the chart and nothing else.
  assert.match(html, /<div aria-hidden="true"><div [^>]*class="recharts-wrapper"[^>]*><\/div><\/div>/);
  assert.equal(html.match(/aria-hidden/g)?.length, 1, "one hidden element");
  // The centred total and the legend stay readable, after the hidden ring.
  const after = html.slice(html.indexOf('<div aria-hidden="true">'));
  assert.match(after, /<\/div><\/div><div class="pointer-events-none[^"]*">.*?>16</);
  for (const d of DATA) assert.ok(after.includes(`>${d.name}<`), `legend lists ${d.name}`);
});
