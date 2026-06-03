#!/usr/bin/env -S npx tsx
/**
 * atlas-context — write and read verified, provenance-tagged context cards.
 *
 * The point: stop re-deriving "what's the status of X" every session. Write a
 * card when you verify a fact (with the source files and a re-check command);
 * read it back next session in one call. A card whose sources changed shows up
 * flagged "re-verify", never as silent truth.
 *
 *   atlas-context add --project nanomind --subject "classifier version" \
 *     --claim "shipped at v0.5.0 (terminal)" \
 *     --source nanomind/nanomind-models.json \
 *     --verify 'jq -e .classifier nanomind/nanomind-models.json' --stale-after 30
 *   atlas-context get --project nanomind
 *   atlas-context verify --project nanomind
 *   atlas-context list --stale
 *
 * The card database lives in the Atlas repo (data/atlas.db); --source paths and
 * verify commands resolve against your current directory (override with --cwd).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDistanceToNow } from "date-fns";
import { getDb, initSchema } from "@/lib/db";
import * as store from "@/lib/context/store";
import { getMetrics } from "@/lib/context/metrics";
import type { ContextCard, Freshness } from "@/lib/types";

// Route the DB to the Atlas repo regardless of where this is invoked from, but
// keep the real cwd for resolving --source paths and verify commands. db.ts
// reads ATLAS_DATA_DIR lazily (at getDb() call time), so setting it in the
// module body — before any command handler runs — is sufficient.
const ATLAS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.ATLAS_DATA_DIR ||= path.join(ATLAS_ROOT, "data");
const INVOKE_CWD = process.cwd();

// --- tiny arg parser -------------------------------------------------------

interface Args {
  _: string[];
  flags: Record<string, string | true>;
}
function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}
function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function list(v: string | true | undefined): string[] {
  const s = str(v);
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

// --- color / formatting ----------------------------------------------------

const noColor = !!process.env.NO_COLOR || !process.stdout.isTTY;
function paint(code: number, s: string): string {
  return noColor ? s : `\x1b[${code}m${s}\x1b[0m`;
}
const dim = (s: string) => paint(2, s);
const bold = (s: string) => paint(1, s);

const PILL: Record<Freshness, { code: number; label: string }> = {
  fresh: { code: 32, label: "FRESH" },
  drifted: { code: 33, label: "DRIFTED" },
  expired: { code: 33, label: "EXPIRED" },
  stale: { code: 31, label: "STALE" },
  unverified: { code: 90, label: "UNVERIFIED" },
};
function pill(f: Freshness): string {
  const p = PILL[f];
  return paint(p.code, `[${p.label}]`);
}
function ago(iso: string | null): string {
  if (!iso) return "never";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

function printCard(c: ContextCard, verbose = true): void {
  console.log(`${pill(c.freshness)} ${bold(c.subject)}  ${dim(c.project)}`);
  console.log(`  ${c.claim}`);
  if (verbose && c.detail) console.log(dim(`  ${c.detail}`));
  if (c.provenance.length) {
    console.log(
      dim(
        `  sources: ${c.provenance
          .map((p) => path.basename(p.path))
          .join(", ")}  ·  verified ${ago(c.lastVerifiedAt)}`
      )
    );
  } else {
    console.log(dim(`  verified ${ago(c.lastVerifiedAt)}`));
  }
  if (c.freshness !== "fresh") {
    if (c.driftedPaths.length) {
      console.log(
        paint(33, `  changed: ${c.driftedPaths.map((p) => path.basename(p)).join(", ")}`)
      );
    }
    const cmd = c.verifyCommand
      ? `${c.verifyCommand}`
      : `atlas-context verify ${c.id}`;
    console.log(paint(36, `  re-verify: ${cmd}`));
  }
  console.log();
}

// --- commands --------------------------------------------------------------

function cmdAdd(a: Args): void {
  const f = a.flags;
  const project = str(f.project);
  const subject = str(f.subject);
  const claim = str(f.claim);
  if (!project || !subject || !claim) {
    console.error("add requires --project, --subject and --claim");
    process.exit(2);
  }
  const db = getDb();
  initSchema(db);
  try {
    const card = store.addCard(db, {
      project,
      subject,
      claim,
      detail: str(f.detail) ?? null,
      sourcePaths: list(f.source),
      verifyCommand: str(f.verify) ?? null,
      staleAfterDays: f["stale-after"] !== undefined ? Number(str(f["stale-after"])) : null,
      tags: list(f.tags),
      links: list(f.links),
      confidence: (str(f.confidence) as ContextCard["confidence"]) ?? "medium",
      visibility: (str(f.visibility) as ContextCard["visibility"]) ?? "private",
      repoSlug: str(f.repo) ?? null,
      cwd: str(f.cwd) ?? INVOKE_CWD,
      runVerify: f["no-verify"] !== true,
    });
    console.log(`${pill(card.freshness)} saved ${bold(card.id)}`);
    printCard(card);
  } catch (err) {
    console.error(`add failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

function cmdGet(a: Args): void {
  const db = getDb();
  initSchema(db);
  const project = str(a.flags.project);
  const cards = store.getCards(
    db,
    { project, freshOnly: a.flags["fresh-only"] === true },
    { recomputeDrift: true, cwd: str(a.flags.cwd) ?? INVOKE_CWD }
  );
  if (a.flags.json === true) {
    console.log(JSON.stringify(cards, null, 2));
    return;
  }
  if (!cards.length) {
    console.log(dim(`no context cards${project ? ` for "${project}"` : ""}.`));
    return;
  }
  const flagged = cards.filter((c) => c.freshness !== "fresh").length;
  console.log(
    bold(`${cards.length} card${cards.length === 1 ? "" : "s"}`) +
      (flagged ? paint(33, `  ·  ${flagged} need re-verification`) : "")
  );
  console.log();
  for (const c of cards) printCard(c);
}

function cmdVerify(a: Args): void {
  const db = getDb();
  initSchema(db);
  const id = a._[1];
  const { results, caught } = store.verifyCards(
    db,
    { id, project: str(a.flags.project), all: a.flags.all === true },
    { cwd: str(a.flags.cwd) ?? INVOKE_CWD }
  );
  if (!results.length) {
    console.log(dim("no matching cards."));
    return;
  }
  for (const c of results) printCard(c);
  const flagged = results.filter((c) => c.freshness !== "fresh").length;
  if (flagged === 0) {
    console.log(dim(`all ${results.length} checked card${results.length === 1 ? "" : "s"} still hold.`));
  } else {
    const parts = [`${flagged} of ${results.length} flagged — re-derive or supersede`];
    if (caught) parts.unshift(`caught ${caught} newly stale this run`);
    console.log(paint(33, parts.join("; ") + "."));
  }
}

function cmdList(a: Args): void {
  const db = getDb();
  initSchema(db);
  const cards = store.getCards(
    db,
    { project: str(a.flags.project) },
    { recomputeDrift: true, cwd: str(a.flags.cwd) ?? INVOKE_CWD, logRead: false }
  );
  const filtered =
    a.flags.stale === true
      ? cards.filter((c) => c.freshness !== "fresh")
      : cards;
  for (const c of filtered) {
    console.log(
      `${pill(c.freshness)} ${c.id}  ${dim(c.subject)}  ${dim(ago(c.lastVerifiedAt))}`
    );
  }
  if (!filtered.length) console.log(dim("nothing to show."));
}

function cmdSupersede(a: Args): void {
  const db = getDb();
  initSchema(db);
  const id = a._[1];
  const by = str(a.flags.by);
  if (!id || !by) {
    console.error("supersede requires <id> and --by <newId>");
    process.exit(2);
  }
  console.log(store.supersedeCard(db, id, by) ? `superseded ${id}` : `not found: ${id}`);
}

function cmdRetire(a: Args): void {
  const db = getDb();
  initSchema(db);
  const id = a._[1];
  if (!id) {
    console.error("retire requires <id>");
    process.exit(2);
  }
  console.log(store.retireCard(db, id) ? `retired ${id}` : `not found: ${id}`);
}

function cmdSearch(a: Args): void {
  const db = getDb();
  initSchema(db);
  const q = a._.slice(1).join(" ");
  if (!q) {
    console.error("search requires a query");
    process.exit(2);
  }
  for (const c of store.searchCards(db, q)) printCard(c, false);
}

function cmdMetrics(a: Args): void {
  const db = getDb();
  initSchema(db);
  const m = getMetrics(db);
  if (a.flags.json === true) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  console.log(bold(`${m.staleCaught} stale fact${m.staleCaught === 1 ? "" : "s"} caught before they misled you`));
  console.log(dim(`~${m.tokensSavedEstimate.toLocaleString()} tokens saved (estimate) across ${m.reads} reads`));
  console.log(
    `coverage: ${paint(32, `${m.freshness.fresh} fresh`)}  ` +
      `${paint(33, `${m.freshness.drifted + m.freshness.expired} drifted/expired`)}  ` +
      `${paint(31, `${m.freshness.stale} stale`)}  ` +
      `${dim(`${m.freshness.unverified} unverified`)}  ` +
      dim(`(${m.activeCards} active cards)`)
  );
}

function help(): void {
  console.log(`atlas-context — verified, provenance-tagged project context

usage:
  atlas-context add --project P --subject S --claim C [--source a,b] [--verify '<cmd>']
                    [--detail D] [--stale-after N] [--tags x,y] [--links ...]
                    [--confidence high|medium|low|unverified] [--visibility private|public]
                    [--repo slug] [--cwd dir] [--no-verify]
  atlas-context get --project P [--fresh-only] [--json]
  atlas-context verify [<id>] [--project P] [--cwd dir]
  atlas-context list [--stale] [--project P]
  atlas-context search <query>
  atlas-context supersede <id> --by <newId>
  atlas-context retire <id>
  atlas-context metrics [--json]

A card needs at least one --source or a --verify command (or --confidence unverified).
Read at session start; re-verify anything flagged before trusting it.`);
}

// --- dispatch --------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
switch (cmd) {
  case "add": cmdAdd(args); break;
  case "get": cmdGet(args); break;
  case "verify": cmdVerify(args); break;
  case "list": cmdList(args); break;
  case "search": cmdSearch(args); break;
  case "supersede": cmdSupersede(args); break;
  case "retire": cmdRetire(args); break;
  case "metrics": cmdMetrics(args); break;
  case undefined:
  case "help":
  case "--help":
  case "-h": help(); break;
  default:
    console.error(`unknown command: ${cmd}\n`);
    help();
    process.exit(2);
}
