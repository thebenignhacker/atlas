import fs from "node:fs";
import { generateOwnerSnapshot, OWNER_SNAPSHOT_PATH } from "@/lib/snapshot";
import { loadConfig } from "@/lib/config";
import type { AIAvailability } from "@/lib/ai/provider";

/**
 * Mirror of aiAvailability() from lib/ai/provider.ts. We can't import that module
 * here because it is marked `server-only` (it pulls the Anthropic SDK and refuses
 * to load outside a server runtime). This script runs under tsx, so it computes
 * availability directly from config + env -- the same inputs the runtime uses.
 */
function computeAiAvailability(): AIAvailability {
  const { ai } = loadConfig();
  if (!ai.enabled)
    return { ok: false, reason: "AI is disabled in atlas.config.json (ai.enabled = false)." };
  switch (ai.provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
        ? { ok: true, provider: "anthropic" }
        : { ok: false, reason: "ANTHROPIC_API_KEY is not set." };
    case "openai":
      return process.env.OPENAI_API_KEY
        ? { ok: true, provider: "openai" }
        : { ok: false, reason: "OPENAI_API_KEY is not set." };
    case "ollama":
      return { ok: true, provider: "ollama" };
    default:
      return { ok: false, reason: `Unknown provider: ${ai.provider}` };
  }
}

/**
 * Generate the FULL owner snapshot from the local database and write it to
 * owner-snapshot.json (gitignored). Unlike `npm run snapshot` (public), this
 * performs NO sanitization -- the output contains paths, private repos, todos,
 * and the AI digest. It must only ever be uploaded to the login-gated owner
 * deployment, never committed.
 *
 * AI availability is captured here (locally, where the API key lives) and baked
 * into the snapshot, since the deployed host has no key.
 */
function main() {
  const snapshot = generateOwnerSnapshot(computeAiAvailability());
  fs.writeFileSync(OWNER_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(
    `atlas: owner snapshot written (${snapshot.repos.length} repos, ${snapshot.todos.length} todos, ` +
      `${snapshot.activity.length} events, ${snapshot.roadmap.length} roadmap, ` +
      `${Object.keys(snapshot.summaries).length} summaries, ` +
      `digest ${snapshot.digest ? "present" : "none"}). NOT for commit -- deploy via Vercel CLI only.`
  );
}

main();
