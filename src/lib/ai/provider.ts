import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";

/**
 * Server-side AI text provider. The API key is read only on the server and never sent to the
 * browser. With no key configured (or AI_TEXT_GENERATION=off) everything still works: callers
 * fall back to the deterministic drafting rules in lib/proposal/generate-rules.ts.
 */

/** USD per million tokens (first-party Claude API list prices). */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export const DEFAULT_MODEL = "claude-opus-5-5";

export function aiSettings() {
  if (typeof window !== "undefined") throw new Error("aiSettings() must not run in the browser");
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL,
    enabled: process.env.AI_TEXT_GENERATION !== "off",
    /** Generations per signed-in user per day (scope + exclusions combined). */
    dailyLimitPerUser: num(process.env.AI_DAILY_LIMIT_PER_USER, 40),
    /** Hard monthly spend ceiling across all users; past it, generation uses the built-in rules. */
    monthlyBudgetUsd: num(process.env.AI_MONTHLY_BUDGET_USD, 25),
  };
}

export const isAiConfigured = () => {
  const s = aiSettings();
  return Boolean(s.enabled && s.apiKey);
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class AiUnavailableError extends Error {
  constructor(message: string, readonly reason: "not_configured" | "refused" | "invalid_output" | "api_error", readonly usage?: { inputTokens: number; outputTokens: number; model: string }) {
    super(message);
  }
}

let client: Anthropic | null = null;
function getClient(apiKey: string) {
  if (!client) client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  return client;
}

/** One structured-output request. Throws AiUnavailableError on any failure so callers can fall back. */
export async function generateStructured<S extends z.ZodType>(opts: { system: string; user: string; schema: S; maxTokens?: number }): Promise<StructuredResult<z.infer<S>>> {
  const s = aiSettings();
  if (!s.enabled || !s.apiKey) throw new AiUnavailableError("AI is not configured", "not_configured");
  let response;
  try {
    response = await getClient(s.apiKey).messages.parse({
      model: s.model,
      max_tokens: opts.maxTokens ?? 8000,
      // Short, well-specified writing task: low effort keeps cost and latency down.
      output_config: { effort: "low", format: zodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new AiUnavailableError(`AI request failed (${e.status ?? "network"})`, "api_error");
    throw new AiUnavailableError("AI request failed", "api_error");
  }
  const usage = { inputTokens: response.usage.input_tokens ?? 0, outputTokens: response.usage.output_tokens ?? 0, model: response.model ?? s.model };
  if (response.stop_reason === "refusal") throw new AiUnavailableError("AI declined the request", "refused", usage);
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new AiUnavailableError("AI returned no usable output", "invalid_output", usage);
  return { data: response.parsed_output as z.infer<S>, ...usage, costUsd: estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens) };
}
