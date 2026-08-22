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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDistanceToNow } from "date-fns";
import { getDb, getMeta, initSchema } from "@/lib/db";
import { legacySessionStateFile, sessionStateFile } from "@/lib/paths";
import * as store from "@/lib/context/store";
import * as train from "@/lib/context/train";
import { getMetrics } from "@/lib/context/metrics";
import type { ContextCard, Freshness } from "@/lib/types";

// Route the DB to the Atlas repo regardless of where this is invoked from, but
// keep the real cwd for resolving --source paths and verify commands.
// lib/paths.ts resolves lazily (at call time), so setting the root in the
// module body — before any command handler runs — is sufficient.
//
// Anchor the repo root to this file's own location, not the caller's cwd, then
// let lib/paths.ts derive everything from it. Previously this set
// ATLAS_DATA_DIR directly while `.current-session` was resolved against the
// repo regardless — so pointing the database elsewhere detached session
// attribution from the cards it labels, with nothing failing to show it.
const ATLAS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.ATLAS_ROOT ||= ATLAS_ROOT;
const INVOKE_CWD = process.cwd();

/**
 * Resolve the originating Claude session id for an `add`:
 *   --session flag  >  $ATLAS_SESSION_ID  >  the state file the hook wrote.
 * Returns undefined when none is available (session attribution is optional).
 */
function resolveSessionId(flag: string | undefined): string | undefined {
  if (flag) return flag;
  if (process.env.ATLAS_SESSION_ID) return process.env.ATLAS_SESSION_ID;
  assertNoLegacySessionState();
  try {
    const fromFile = fs.readFileSync(sessionStateFile(), "utf8").trim();
    return fromFile || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuse to run while a session-state file sits at the pre-unification
 * location AND we are now reading a different one.
 *
 * Failing loudly is the point. Both files look valid, so any silent policy —
 * prefer the new one, prefer the newer mtime, merge — stamps some session id
 * onto every card written from here on, and a wrong origin is worse than none
 * because it reads as evidence. The condition is also self-clearing: delete the
 * stale file and the message goes away.
 */
function assertNoLegacySessionState(): void {
  const legacy = legacySessionStateFile();
  if (!legacy) return;
  console.error(
    `atlas: found a session-state file at the old location:\n` +
      `  ${legacy}\n` +
      `but session state is now read from:\n` +
      `  ${sessionStateFile()}\n` +
      `Refusing to guess which is current — a wrong originSessionId is worse ` +
      `than none. Delete the old file to continue.`
  );
  process.exit(1);
}

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
  const sensitive = c.sensitive ? " " + paint(31, "[SENSITIVE]") : "";
  console.log(`${pill(c.freshness)}${sensitive} ${bold(c.subject)}  ${dim(c.project)}`);
  console.log(`  ${c.claim}`);
  if (verbose && c.detail) console.log(dim(`  ${c.detail}`));
  if (c.sensitive) console.log(paint(31, "  never published (sensitive)"));
  if (c.originSessionId)
    console.log(dim(`  session ${c.originSessionId.slice(0, 8)}`));
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
      sensitive: f.sensitive === true,
      repoSlug: str(f.repo) ?? null,
      originSessionId: resolveSessionId(str(f.session)) ?? null,
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

function cmdSession(a: Args): void {
  const db = getDb();
  initSchema(db);
  const sub = a._[1];
  switch (sub) {
    case "register": {
      const id = str(a.flags.id);
      if (!id) {
        console.error("session register requires --id <session-id>");
        process.exit(2);
      }
      const s = store.registerSession(db, {
        id,
        startedAt: str(a.flags.started),
        summary: str(a.flags.summary) ?? undefined,
      });
      console.log(`registered session ${bold(s.id)} (${ago(s.startedAt)})`);
      break;
    }
    // `begin` = write the state file + register, in one call.
    //
    // Exists so the SessionStart hook never computes a path. The hook used to
    // `mkdir -p "$ATLAS/data"` itself, which recreated that directory inside
    // the repo on EVERY session — reopening the "no data directory in the
    // public tree" property by itself, the morning after any migration, with
    // no failure to notice. A shell script cannot be kept in sync with
    // lib/paths.ts; not letting it try is the fix.
    case "begin": {
      const id = str(a.flags.id);
      if (!id) {
        console.error("session begin requires --id <session-id>");
        process.exit(2);
      }
      const stateFile = sessionStateFile();
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, `${id}\n`);
      const s = store.registerSession(db, { id, startedAt: str(a.flags.started) });
      console.log(`began session ${bold(s.id)} (state: ${stateFile})`);
      break;
    }
    case "update": {
      const id = str(a.flags.id);
      if (!id) {
        console.error("session update requires --id <session-id>");
        process.exit(2);
      }
      const s = store.updateSession(db, id, {
        summary: a.flags.summary !== undefined ? str(a.flags.summary) ?? "" : undefined,
        branches: a.flags.branches !== undefined ? list(a.flags.branches) : undefined,
      });
      console.log(s ? `updated session ${bold(id)}` : `not found: ${id}`);
      break;
    }
    case "list":
    case undefined: {
      const sessions = store.getSessions(db);
      if (a.flags.json === true) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }
      if (!sessions.length) {
        console.log(dim("no sessions recorded yet."));
        return;
      }
      for (const s of sessions) {
        const repos = s.repos.length ? dim(` · ${s.repos.join(", ")}`) : "";
        console.log(
          `${bold(s.id.slice(0, 8))} ${dim(ago(s.startedAt))}  ${s.cardCount} card${s.cardCount === 1 ? "" : "s"}${repos}`
        );
        if (s.summary) console.log(dim(`  ${s.summary}`));
      }
      break;
    }
    default:
      console.error(`unknown session subcommand: ${sub}`);
      process.exit(2);
  }
}

// --- release trains --------------------------------------------------------

function deadlineNote(item: train.TrainItem, now: Date): string | null {
  const state = train.deadlineState(item, now);
  if (state === "none") return null;
  const action = item.deadlineAction ? ` — ${item.deadlineAction}` : "";
  if (state === "overdue") return paint(31, `deadline ${item.deadline} OVERDUE${action}`);
  if (state === "due") return paint(33, `deadline ${item.deadline} is TODAY${action}`);
  return dim(`deadline ${item.deadline}${action}`);
}

function printTrain(status: train.TrainStatus, now: Date): void {
  console.log(`${bold(status.repo)} ${dim("— release train")}`);
  const lease = status.lease;
  if (lease.state === "none") {
    console.log(
      dim(`  lease: none — take with: atlas-context train lease ${status.repo}`)
    );
  } else {
    const l = lease.lease;
    const line = `  lease: ${l.sessionId.slice(0, 8)} until ${l.expiresAt}`;
    console.log(
      lease.state === "active"
        ? paint(32, line)
        : paint(31, `${line} — EXPIRED, held past its TTL; take it over explicitly`)
    );
  }
  console.log(
    `  ${status.pending.length} pending · ${status.doneCount} done`
  );
  for (const item of status.pending) {
    console.log(`   #${item.id} ${dim(`[${item.kind}]`)} ${item.item}`);
    const note = deadlineNote(item, now);
    if (note) console.log(`       ${note}`);
  }
  console.log();
}

/**
 * Advisory only: if the session board (written by `npm run scan`) shows another
 * session holding this repo's primary checkout, say so before the lease is
 * taken. Preference, not enforcement — the gates stay the wall.
 */
function warnIfCheckoutHeldElsewhere(
  db: ReturnType<typeof getDb>,
  repo: string,
  mySessionId: string
): void {
  try {
    const raw = getMeta(db, "sessionBoard");
    if (!raw) return;
    const board = JSON.parse(raw) as {
      trees?: { repos?: { repo: string; holder: { sessionId: string | null; file: string } | null }[] }[];
    };
    for (const tree of board.trees ?? []) {
      for (const r of tree.repos ?? []) {
        if (r.repo !== repo || !r.holder?.sessionId) continue;
        if (r.holder.sessionId !== mySessionId) {
          console.log(
            paint(
              33,
              `note: the session board shows ${r.holder.sessionId.slice(0, 8)} holding the ${repo} checkout (${r.holder.file}) — preference for cutting goes to that session`
            )
          );
        }
      }
    }
  } catch {
    // The board is a convenience input here; its absence must not block a lease.
  }
}

function cmdTrain(a: Args): void {
  const db = getDb();
  initSchema(db);
  const sub = a._[1];
  const repo = a._[2];
  const now = new Date();
  // Explicit annotation on the CONST, not just the arrow: control-flow analysis
  // only treats a call as terminating when the callee's declared type says never.
  const need: (what: string) => never = (what) => {
    console.error(`train ${sub} requires ${what}`);
    process.exit(2);
  };
  switch (sub) {
    case "enqueue": {
      if (!repo) need("<repo>");
      const itemText = str(a.flags.item);
      if (!itemText) need("--item <text>");
      try {
        const item = train.enqueueItem(db, {
          repo,
          item: itemText,
          kind: a.flags["closing-step"] === true ? "closing-step" : "obligation",
          deadline: str(a.flags.deadline) ?? null,
          deadlineAction: str(a.flags["deadline-action"]) ?? null,
          sessionId: resolveSessionId(str(a.flags.session)) ?? null,
        }, now);
        console.log(
          `queued #${item.id} ${dim(`[${item.kind}]`)} on ${bold(repo)} — the merge is the handoff; move on`
        );
      } catch (err) {
        console.error(`enqueue failed: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    case "status": {
      if (repo) {
        const status = train.trainStatus(db, repo, now);
        if (!status) {
          console.error(`no release train for "${repo}"`);
          process.exit(1);
        }
        if (a.flags.json === true) {
          console.log(JSON.stringify({
            ...status,
            pending: status.pending.map((i) => ({
              ...i,
              deadlineState: train.deadlineState(i, now),
            })),
          }, null, 2));
          return;
        }
        printTrain(status, now);
        return;
      }
      const all = train.allStatuses(db, now);
      if (a.flags.json === true) {
        console.log(JSON.stringify(all, null, 2));
        return;
      }
      if (!all.length) {
        console.log(dim("no release trains."));
        return;
      }
      for (const s of all) printTrain(s, now);
      break;
    }
    case "lease": {
      if (!repo) need("<repo>");
      const sessionId = resolveSessionId(str(a.flags.session));
      if (!sessionId) {
        console.error(
          "train lease requires a session identity (run inside a Claude session, set ATLAS_SESSION_ID, or pass --session <id>) — an anonymous lease cannot be compared against anyone"
        );
        process.exit(2);
      }
      const ttl = a.flags["ttl-hours"] !== undefined ? Number(str(a.flags["ttl-hours"])) : 24;
      if (!Number.isFinite(ttl) || ttl <= 0) {
        console.error(`--ttl-hours must be a positive number`);
        process.exit(2);
      }
      try {
        warnIfCheckoutHeldElsewhere(db, repo, sessionId);
        const result = train.takeLease(db, repo, sessionId, ttl, now);
        if (!result.ok) {
          console.error(
            paint(
              31,
              `refused: ${result.holder.sessionId.slice(0, 8)} holds the ${repo} conductor lease until ${result.holder.expiresAt} — coordinate with that session or wait for expiry`
            )
          );
          process.exit(1);
        }
        if (result.displaced) {
          console.log(
            paint(
              33,
              `took over an EXPIRED lease from ${result.displaced.sessionId.slice(0, 8)} (expired ${result.displaced.expiresAt})`
            )
          );
        }
        console.log(
          `${result.renewed ? "renewed" : "took"} the ${bold(repo)} conductor lease until ${result.lease.expiresAt}`
        );
      } catch (err) {
        console.error(`lease failed: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    case "release": {
      if (!repo) need("<repo>");
      const sessionId = resolveSessionId(str(a.flags.session)) ?? null;
      const result = train.releaseLease(db, repo, sessionId, now);
      if (!result.released) {
        console.log(dim(`no lease to release on ${repo}.`));
        return;
      }
      if (result.foreign) {
        console.log(
          paint(
            33,
            `released a lease held by ${result.wasHeldBy.slice(0, 8)} — if that session is still cutting, you have just un-coordinated it`
          )
        );
      } else {
        console.log(`released the ${bold(repo)} conductor lease`);
      }
      break;
    }
    case "done": {
      if (!repo) need("<repo>");
      const id = Number(str(a.flags.id));
      if (!Number.isInteger(id)) need("--id <item-number>");
      const item = train.markDone(db, repo, id, resolveSessionId(str(a.flags.session)) ?? null, now);
      if (!item) {
        console.error(`no item #${id} on the ${repo} train`);
        process.exit(1);
      }
      console.log(`done #${item.id} ${dim(`[${item.kind}]`)} ${item.item}`);
      break;
    }
    // For the SessionStart hook: one compact line per train with pending items,
    // silent when there is nothing pending — quiet mornings stay quiet.
    case "surface": {
      const all = train.allStatuses(db, now);
      const withPending = all.filter((s) => s.pending.length > 0);
      if (!withPending.length) return;
      console.log(
        "[release-train] trains with pending items (details: atlas-context train status <repo>):"
      );
      for (const s of withPending) {
        const overdue = s.pending.filter((i) => train.deadlineState(i, now) === "overdue");
        const due = s.pending.filter((i) => train.deadlineState(i, now) === "due");
        const bits = [`${s.pending.length} pending`];
        if (overdue.length) {
          bits.push(
            `${overdue.length} OVERDUE (${overdue
              .map((i) => `${i.deadline}: ${i.deadlineAction ?? i.item}`)
              .join("; ")})`
          );
        }
        if (due.length) bits.push(`${due.length} due today`);
        if (s.lease.state === "active") bits.push(`lease ${s.lease.lease.sessionId.slice(0, 8)}`);
        if (s.lease.state === "expired") bits.push("lease EXPIRED");
        console.log(`  ${s.repo}: ${bits.join(" — ")}`);
      }
      break;
    }
    default:
      console.error(
        `unknown train subcommand: ${sub ?? "(none)"} — expected enqueue|status|lease|release|done|surface`
      );
      process.exit(2);
  }
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
                    [--sensitive] [--session <id>] [--repo slug] [--cwd dir] [--no-verify]
  atlas-context get --project P [--fresh-only] [--json]
  atlas-context verify [<id>] [--project P] [--cwd dir]
  atlas-context list [--stale] [--project P]
  atlas-context search <query>
  atlas-context supersede <id> --by <newId>
  atlas-context retire <id>
  atlas-context session [list] [--json]
  atlas-context session begin    --id <id> [--started <iso>]
  atlas-context session register --id <id> [--started <iso>] [--summary S]
  atlas-context session update --id <id> [--summary S] [--branches a,b]
  atlas-context metrics [--json]

  atlas-context train enqueue <repo> --item "text" [--closing-step]
                    [--deadline YYYY-MM-DD] [--deadline-action "what to cut"]
  atlas-context train status [<repo>] [--json]
  atlas-context train lease <repo> [--ttl-hours N] [--session <id>]
  atlas-context train release <repo>
  atlas-context train done <repo> --id N
  atlas-context train surface

Release trains make a repo's release queue DATA: enqueue obligations at merge
time and move on (the merge is the handoff); exactly one session at a time holds
the advisory conductor lease to cut. Deadlines surface loudly once due. The
publish gates remain the enforcement of last resort.

A card needs at least one --source or a --verify command (or --confidence unverified).
--sensitive marks a card never-publishable (dropped from every public surface, even
for a GitHub-public repo); repo-level sensitivity is the "sensitiveRepos" list in
atlas.config.json. --session attributes the card to a Claude session (auto-filled from
the SessionStart hook). Read at session start; re-verify anything flagged before trusting it.`);
}

// --- dispatch --------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
try {
  switch (cmd) {
    case "add": cmdAdd(args); break;
    case "get": cmdGet(args); break;
    case "verify": cmdVerify(args); break;
    case "list": cmdList(args); break;
    case "search": cmdSearch(args); break;
    case "supersede": cmdSupersede(args); break;
    case "retire": cmdRetire(args); break;
    case "session": cmdSession(args); break;
    case "train": cmdTrain(args); break;
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
} catch (err) {
  // Print the MESSAGE, not the Error object. getDb() refusing to create a
  // database is the ordinary first-run failure and its message already says
  // what to run; a stack trace buries that one actionable line. Same policy
  // as scripts/scan.ts; the stack stays available behind ATLAS_DEBUG.
  console.error(`atlas-context: ${err instanceof Error ? err.message : String(err)}`);
  if (process.env.ATLAS_DEBUG && err instanceof Error) console.error(err.stack);
  process.exit(1);
}
