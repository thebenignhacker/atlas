import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "@/lib/config";
import { isOwnerMode } from "@/lib/mode";
import { loadOwnerSnapshot } from "@/lib/snapshot";

export interface CompletionResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface CompletionRequest {
  system: string;
  prompt: string;
  /** "fast" (triage/summaries) or "deep" (digest). */
  tier?: "fast" | "deep";
  maxTokens?: number;
}

export type AIAvailability =
  | { ok: true; provider: string }
  | { ok: false; reason: string };

/** Is the AI layer usable right now? Drives graceful UI degradation. */
export function aiAvailability(): AIAvailability {
  // Owner deployment has no API key on the host; report the availability that
  // was captured locally when the snapshot was generated.
  if (isOwnerMode()) return loadOwnerSnapshot().ai;
  const { ai } = loadConfig();
  if (!ai.enabled) return { ok: false, reason: "AI is disabled in atlas.config.json (ai.enabled = false)." };
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

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const { ai } = loadConfig();
  const model = req.tier === "deep" ? ai.models.deep : ai.models.fast;
  const maxTokens = req.maxTokens ?? (req.tier === "deep" ? 2000 : 800);

  switch (ai.provider) {
    case "anthropic":
      return anthropicComplete(req, model, maxTokens);
    case "openai":
      return openaiComplete(req, model, maxTokens);
    case "ollama":
      return ollamaComplete(req, model, maxTokens);
    default:
      throw new Error(`Unknown AI provider: ${ai.provider}`);
  }
}

async function anthropicComplete(
  req: CompletionRequest,
  model: string,
  maxTokens: number
): Promise<CompletionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    promptTokens: msg.usage.input_tokens,
    completionTokens: msg.usage.output_tokens,
    model,
  };
}

async function openaiComplete(
  req: CompletionRequest,
  model: string,
  maxTokens: number
): Promise<CompletionResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    model,
  };
}

async function ollamaComplete(
  req: CompletionRequest,
  model: string,
  maxTokens: number
): Promise<CompletionResult> {
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { num_predict: maxTokens },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.message?.content ?? "",
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
    model,
  };
}
