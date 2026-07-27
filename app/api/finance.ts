import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection.js";
import { settings } from "../db/schema.js";
// type-only import — erased at runtime, so no cycle with provider.ts
import type { ResolvedKey } from "./ai/provider.js";

/* ------------------------------------------------------------------ */
/* Finance data lives in the key/value settings table (no schema        */
/* migration needed): "finance.pricing", "finance.usage",              */
/* "finance.budgets". Usage accumulation is read-modify-write — fine   */
/* at this platform's volume.                                          */
/* ------------------------------------------------------------------ */

export interface ModelPrice {
  /** stable id used to match usage entries (prefix match on model name) */
  id: string;
  label: string;
  provider: string; // display name, e.g. "Google Gemini"
  providerId: string; // stable id shared with usage/budgets, e.g. "gemini"
  inPerM: number; // USD per 1M input tokens
  outPerM: number; // USD per 1M output tokens
}

export interface PricingTable {
  updatedAt: string; // ISO
  source: "seed" | "web";
  models: ModelPrice[];
}

export interface UsageEntry {
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  lastAt: string; // ISO
}

export interface ProviderBudget {
  amountUsd: number;
  setAt: string; // ISO
  /** usage totals at the moment the budget was entered — spend counts from here */
  baseline: Record<string, { inputTokens: number; outputTokens: number }>;
}

/** Pricing seeded from LiteLLM's public price feed (checked 2026-07-27);
 *  the Refresh button re-fetches the live feed so this never has to be
 *  hand-maintained. `litellm` lists the feed keys to try, in order. */
const MODEL_CATALOG: (Omit<ModelPrice, "inPerM" | "outPerM"> & {
  litellm: string[];
  seedInPerM: number;
  seedOutPerM: number;
})[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google Gemini", providerId: "gemini", litellm: ["gemini/gemini-2.5-flash", "gemini-2.5-flash"], seedInPerM: 0.3, seedOutPerM: 2.5 },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "Google Gemini", providerId: "gemini", litellm: ["gemini/gemini-2.0-flash", "gemini-2.0-flash"], seedInPerM: 0.1, seedOutPerM: 0.4 },
  { id: "claude-3-5-haiku", label: "Claude 3.5 Haiku", provider: "Anthropic", providerId: "anthropic", litellm: ["claude-3-5-haiku-20241022", "claude-3-5-haiku-latest"], seedInPerM: 0.8, seedOutPerM: 4 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI", providerId: "openai", litellm: ["gpt-4o-mini"], seedInPerM: 0.15, seedOutPerM: 0.6 },
  { id: "grok-2", label: "Grok 2", provider: "xAI Grok", providerId: "grok", litellm: ["xai/grok-2-latest", "grok-2-latest"], seedInPerM: 2, seedOutPerM: 10 },
  { id: "deepseek-chat", label: "DeepSeek Chat", provider: "DeepSeek", providerId: "deepseek", litellm: ["deepseek/deepseek-chat", "deepseek-chat"], seedInPerM: 0.28, seedOutPerM: 0.42 },
  { id: "moonshot-v1-8k", label: "Kimi (Moonshot v1 8k)", provider: "Moonshot Kimi", providerId: "kimi", litellm: ["moonshot/moonshot-v1-8k", "moonshot-v1-8k"], seedInPerM: 0.2, seedOutPerM: 2 },
  { id: "openrouter/gpt-4o-mini", label: "GPT-4o mini (via OpenRouter)", provider: "OpenRouter", providerId: "openrouter", litellm: ["openrouter/openai/gpt-4o-mini", "gpt-4o-mini"], seedInPerM: 0.15, seedOutPerM: 0.6 },
];

export const SEED_PRICING: PricingTable = {
  updatedAt: "2026-07-27T00:00:00.000Z",
  source: "seed",
  models: MODEL_CATALOG.map(({ litellm: _l, seedInPerM, seedOutPerM, ...m }) => ({
    ...m,
    inPerM: seedInPerM,
    outPerM: seedOutPerM,
  })),
};

/* -------------------- settings-table JSON helpers ------------------ */

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const row = await getDb().query.settings.findFirst({ where: eq(settings.key, key) });
    return row ? (row.valueJson as T) : null;
  } catch (err) {
    console.error(`[finance] failed to read ${key}:`, err);
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ key, valueJson: value })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: value } });
}

export async function getPricing(): Promise<PricingTable> {
  return (await readJson<PricingTable>("finance.pricing")) ?? SEED_PRICING;
}

export async function getUsage(): Promise<Record<string, UsageEntry>> {
  return (await readJson<Record<string, UsageEntry>>("finance.usage")) ?? {};
}

export async function getBudgets(): Promise<Record<string, ProviderBudget>> {
  return (await readJson<Record<string, ProviderBudget>>("finance.budgets")) ?? {};
}

export async function saveBudgets(b: Record<string, ProviderBudget>): Promise<void> {
  await writeJson("finance.budgets", b);
}

/* ------------------------- live refresh ---------------------------- */

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/**
 * Re-fetch model pricing from LiteLLM's maintained public feed so the cost
 * table stays current. Models missing from the feed keep their previous
 * (or seed) price.
 */
export async function refreshPricingFromWeb(): Promise<PricingTable> {
  const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`price feed responded ${res.status}`);
  const feed = (await res.json()) as Record<
    string,
    { input_cost_per_token?: number; output_cost_per_token?: number }
  >;
  const previous = await getPricing();
  const models: ModelPrice[] = MODEL_CATALOG.map((m) => {
    const prev = previous.models.find((p) => p.id === m.id);
    let entry = m.litellm.map((k) => feed[k]).find((e) => e?.input_cost_per_token != null);
    if (!entry) {
      // fall back to a prefix match, e.g. a renamed claude-3-5-haiku-YYYYMMDD
      const key = Object.keys(feed).find(
        (k) => k.startsWith(m.litellm[m.litellm.length - 1]) && feed[k].input_cost_per_token != null,
      );
      entry = key ? feed[key] : undefined;
    }
    const { litellm: _l, seedInPerM, seedOutPerM, ...base } = m;
    return {
      ...base,
      inPerM: entry?.input_cost_per_token != null ? entry.input_cost_per_token * 1e6 : (prev?.inPerM ?? seedInPerM),
      outPerM: entry?.output_cost_per_token != null ? entry.output_cost_per_token * 1e6 : (prev?.outPerM ?? seedOutPerM),
    };
  });
  const table: PricingTable = { updatedAt: new Date().toISOString(), source: "web", models };
  await writeJson("finance.pricing", table);
  return table;
}

/* ------------------------- usage capture --------------------------- */

/** Stable provider id for a resolved key — matches MODEL_CATALOG.providerId. */
export function providerIdForKey(key: Pick<ResolvedKey, "provider" | "baseUrl">): string {
  const base = key.baseUrl ?? "";
  if (/x\.ai/.test(base)) return "grok";
  if (/deepseek/.test(base)) return "deepseek";
  if (/moonshot/.test(base)) return "kimi";
  if (/openrouter/.test(base)) return "openrouter";
  return key.provider; // gemini | anthropic | openai
}

/**
 * Accumulate one completion's token usage. Fire-and-forget from the AI path:
 * never throws, never blocks a generation on finance bookkeeping.
 */
export async function recordAiUsage(
  key: Pick<ResolvedKey, "provider" | "baseUrl">,
  model: string,
  usage: { input: number; output: number },
): Promise<void> {
  try {
    if (!usage.input && !usage.output) return;
    const providerId = providerIdForKey(key);
    const entryKey = `${providerId}|${model}`;
    const all = await getUsage();
    const prev = all[entryKey];
    all[entryKey] = {
      providerId,
      model,
      inputTokens: (prev?.inputTokens ?? 0) + usage.input,
      outputTokens: (prev?.outputTokens ?? 0) + usage.output,
      calls: (prev?.calls ?? 0) + 1,
      lastAt: new Date().toISOString(),
    };
    await writeJson("finance.usage", all);
  } catch (err) {
    console.warn("[finance] usage record failed (ignored):", err);
  }
}

/* ------------------------- cost estimation ------------------------- */

/** Match a usage entry to a pricing row (exact id, then prefix on model). */
export function priceForUsage(pricing: PricingTable, u: UsageEntry): ModelPrice | null {
  const model = u.model.replace(/^openai\//, "");
  return (
    pricing.models.find((m) => m.providerId === u.providerId && model.startsWith(m.id)) ??
    pricing.models.find((m) => model.startsWith(m.id)) ??
    pricing.models.find((m) => m.providerId === u.providerId) ??
    null
  );
}

export function estimateUsd(
  u: { inputTokens: number; outputTokens: number },
  price: ModelPrice | null,
): number {
  if (!price) return 0;
  return (u.inputTokens / 1e6) * price.inPerM + (u.outputTokens / 1e6) * price.outPerM;
}
