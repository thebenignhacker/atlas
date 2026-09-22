import { projectFromCwd } from "@/lib/usage/parse";

/**
 * Token mining from one session transcript: what each API request cost in
 * tokens, and how much context each tool result went on to carry.
 *
 * Pure: takes parsed JSONL lines, returns rows. No file I/O, no network, and
 * no prompt bodies: the only input values kept are the file named by a tool
 * call's `file_path` / `path` key (owner-only, so a carry row can name what to
 * act on) and the byte length of tool results.
 *
 * Vocabulary shared with the maintainer's own transcript reader:
 *   - usage is summed ONCE per `requestId` (every transcript line of one request
 *     carries the same usage block; the first occurrence wins);
 *   - a TURN starts at a user line that is not made only of tool results;
 *   - a turn's PREFIX is its last request's input + cache creation + cache read,
 *     the context the next turn re-bills in full.
 * Carry follows the maintainer's cost report: a tool result's estimated tokens
 * (bytes / 3.6, images 1500) times the assistant responses that followed it in
 * the session, i.e. how many more times that result was sent back.
 */

/** One API request as the transcript records it. Measured. */
export interface UsageRequest {
  /** `requestId` of the transcript line, else the message id, else session:line. */
  id: string;
  sessionId: string | null;
  ts: string | null;
  model: string | null;
  project: string | null;
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  /** Ordinal of the turn this request answered (1-based; 0 before any turn). */
  turnIndex: number;
}

/** One tool result and the context it carried afterwards. Estimated. */
export interface CarryRow {
  /** tool_use id the result answered, else session:line. */
  id: string;
  sessionId: string | null;
  ts: string | null;
  tool: string;
  /** The file the tool call named (file_path or path input), owner-only. */
  file: string | null;
  project: string | null;
  resultTokensEst: number;
  /** Distinct assistant responses after this result in the session. */
  responsesRemaining: number;
  carryEst: number;
}

export interface MinedTokens {
  requests: UsageRequest[];
  carry: CarryRow[];
  turns: number;
}

const TOKENS_PER_BYTE = 1 / 3.6;
const IMAGE_TOKENS = 1500;

/** Estimated tokens of a tool result's content, the cost report's own rule. */
export function estimateResultTokens(content: unknown): number {
  if (typeof content === "string") return Math.ceil(content.length * TOKENS_PER_BYTE);
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content) {
    const b = block as { type?: string };
    // Rounded per block, as the cost report does, so the two agree to the token.
    if (b?.type === "image") n += IMAGE_TOKENS;
    else n += Math.ceil(JSON.stringify(block).length * TOKENS_PER_BYTE);
  }
  return n;
}

function isToolResultOnly(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((b) => (b as { type?: string })?.type === "tool_result");
}

function fileOf(input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  for (const key of ["file_path", "path", "notebook_path"]) {
    const v = i[key];
    if (typeof v === "string" && v.length > 0 && v.length < 512) return v;
  }
  return null;
}

/**
 * Mine the requests and carry rows of one transcript. `lines` are the parsed
 * JSONL objects in file order; unparseable lines were dropped by the caller.
 */
export function mineTokens(lines: Record<string, unknown>[]): MinedTokens {
  const requests: UsageRequest[] = [];
  const seen = new Set<string>();
  const toolUses = new Map<string, { tool: string; file: string | null }>();
  const pending: { row: Omit<CarryRow, "responsesRemaining" | "carryEst">; at: number }[] = [];
  let turn = 0;
  let responses = 0;

  lines.forEach((line, i) => {
    const index = i + 1;
    const message = line.message as Record<string, unknown> | undefined;
    if (!message) return;
    const sessionId = typeof line.sessionId === "string" ? line.sessionId : null;
    const ts = typeof line.timestamp === "string" ? line.timestamp : null;
    const project = projectFromCwd(typeof line.cwd === "string" ? line.cwd : null);
    const content = message.content;

    if (line.type === "user") {
      if (Array.isArray(content)) {
        for (const raw of content) {
          const b = raw as Record<string, unknown>;
          if (b?.type !== "tool_result") continue;
          const useId = typeof b.tool_use_id === "string" ? b.tool_use_id : null;
          const use = useId ? toolUses.get(useId) : undefined;
          pending.push({
            row: {
              id: useId ?? `${sessionId ?? "s"}:${index}`,
              sessionId,
              ts,
              tool: use?.tool ?? "unknown",
              file: use?.file ?? null,
              project,
              resultTokensEst: estimateResultTokens(b.content),
            },
            at: responses,
          });
        }
      }
      if (!isToolResultOnly(content)) turn += 1;
      return;
    }

    if (line.type !== "assistant") return;
    if (Array.isArray(content)) {
      for (const raw of content) {
        const b = raw as Record<string, unknown>;
        if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
          toolUses.set(b.id, { tool: b.name, file: fileOf(b.input) });
      }
    }
    const usage = message.usage as Record<string, unknown> | undefined;
    if (!usage) return;
    const id =
      (typeof line.requestId === "string" && line.requestId) ||
      (typeof message.id === "string" && message.id) ||
      `${sessionId ?? "s"}:${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    responses += 1;
    const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
    requests.push({
      id,
      sessionId,
      ts,
      model: typeof message.model === "string" ? message.model : null,
      project,
      input: n("input_tokens"),
      cacheCreation: n("cache_creation_input_tokens"),
      cacheRead: n("cache_read_input_tokens"),
      output: n("output_tokens"),
      turnIndex: turn,
    });
  });

  const carry: CarryRow[] = pending.map((p) => {
    const responsesRemaining = Math.max(0, responses - p.at);
    return { ...p.row, responsesRemaining, carryEst: p.row.resultTokensEst * responsesRemaining };
  });
  return { requests, carry, turns: turn };
}
