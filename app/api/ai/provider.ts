import { getDb } from "../queries/connection.js";
import { apiKeys } from "../../db/schema.js";
import { and, eq } from "drizzle-orm";
import { getSettings } from "../settings.js";
import { recordAiUsage } from "../finance.js";
import type { AiCapability, AiProvider, ImageProvider } from "../../contracts/types.js";

/* ------------------------------------------------------------------ */
/* Pluggable text-completion provider layer.                            */
/* Priority: user's BYOK key for the capability -> platform key from    */
/* settings -> server .env key -> null (caller falls back to the        */
/* deterministic mock).                                                 */
/* Server-side only — keys NEVER leave the server.                      */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ResolvedKey {
  provider: ImageProvider;
  apiKey: string;
  baseUrl?: string;
  /** Override the provider's default model (e.g. OpenRouter/DeepSeek routes). */
  model?: string;
  source: "byok" | "platform" | "env";
}

export interface CompletionResult {
  text: string;
  provider: AiProvider;
  source: "byok" | "platform" | "env";
  /** Stable identity of the exact key/endpoint that answered — lets callers
   *  rotate through providers without repeats (see completeText.excludeKeyIds). */
  keyId?: string;
}

/** Stable identity for one resolved key (provider + endpoint + model). */
export function resolvedKeyId(k: ResolvedKey): string {
  return `${k.provider}|${k.baseUrl ?? "-"}|${k.model ?? "-"}`;
}

/**
 * Reorder candidates so the first ones all hit DIFFERENT services, keeping
 * relative priority within each group.
 *
 * Callers cap how many candidates they can afford (a deck gets two, because
 * two slow tries already fill a 60s invocation). That cap is only a fallback
 * if the tries land on different services — and they did not: a platform
 * Gemini key and an env Gemini key are two entries but one API, so when Gemini
 * was slow BOTH tries timed out against it and Grok, OpenAI, DeepSeek and Kimi
 * were never reached, despite being configured and healthy.
 *
 * Keys are grouped by endpoint rather than by `provider`, because most
 * providers here speak the OpenAI protocol — Grok, DeepSeek, Kimi and
 * OpenRouter all report `provider: "openai"` and only the base URL tells them
 * apart. Duplicates are kept, just moved behind one of every other service, so
 * a second key for the same API is still tried when the budget allows.
 */
export function orderForDiversity(candidates: ResolvedKey[]): ResolvedKey[] {
  const firstOfService: ResolvedKey[] = [];
  const duplicates: ResolvedKey[] = [];
  const seen = new Set<string>();
  for (const k of candidates) {
    const service = `${k.provider}|${k.baseUrl ?? "-"}`;
    if (seen.has(service)) duplicates.push(k);
    else {
      seen.add(service);
      firstOfService.push(k);
    }
  }
  return [...firstOfService, ...duplicates];
}

/** Below this there is not enough time left for any reply to arrive. */
export const MIN_SLICE_MS = 6_000;

/**
 * How long the next candidate may take, given a shared deadline.
 *
 * Returns null when the remaining time is too short to be worth spending —
 * the caller reports that as a skip rather than burning the tail of the
 * budget on a request that cannot land. With no deadline set every candidate
 * simply gets the full per-call timeout, which is the old behaviour.
 */
export function nextSlice(
  timeoutMs: number,
  deadline: number | null,
  now: number,
): number | null {
  if (deadline === null) return timeoutMs;
  const remaining = deadline - now;
  if (remaining < MIN_SLICE_MS) return null;
  return Math.min(timeoutMs, remaining);
}

/** Providers with a chat/completion API (ElevenLabs is speech-only). */
type TextProvider = Exclude<AiProvider, "elevenlabs">;

/** The ids of every text key currently available to this user — the size of
 *  the rotation pool for provider-cycling callers. */
export async function textKeyIdPool(userId: number | undefined): Promise<string[]> {
  const candidates = await resolveKeyCandidates(userId, "text");
  return candidates.map(resolvedKeyId);
}

const DEFAULT_MODELS: Record<TextProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.5-flash",
};

/**
 * Gemini retires model versions over time; when a model name 404s we fall
 * through this list so the app keeps working without a code change. A
 * GEMINI_TEXT_MODEL env/BYOK model override is always tried first.
 */
const GEMINI_TEXT_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
];

const DEFAULT_BASE_URLS: Record<TextProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

/**
 * All usable keys from server environment variables (.env), in priority
 * order. This is the final fallback tier so the platform works out of the
 * box with the keys documented in .env.example — no admin/settings step
 * required. Returning every candidate (not just the first) lets callers
 * cascade to the next provider when one key is invalid or its API is down.
 */
function envKeyCandidates(capability: AiCapability): ResolvedKey[] {
  const e = process.env;
  const val = (name: string) => (e[name]?.trim() ? e[name]!.trim() : null);
  const out: ResolvedKey[] = [];

  if (capability === "image") {
    // Same shape as the text cascade: every configured generator is offered,
    // in order, so one dead provider costs a retry instead of the picture.
    // AI_IMAGE_PRIORITY reorders them without a deploy.
    const builders: Record<string, () => ResolvedKey | null> = {
      // "Nano Banana" is Google's gemini-2.5-flash-image (see
      // GEMINI_IMAGE_MODELS) — it already leads this list.
      gemini: () => {
        const k = val("GEMINI_API_KEY");
        return k
          ? { provider: "gemini", apiKey: k, model: val("GEMINI_IMAGE_MODEL") ?? undefined, source: "env" }
          : null;
      },
      openai: () => {
        const k = val("IMAGE_API_KEY") ?? val("OPENAI_API_KEY");
        // IMAGE_API_URL may be the full endpoint; callers append /images/generations.
        const baseUrl = val("IMAGE_API_URL")?.replace(/\/images\/generations\/?$/, "") ?? undefined;
        return k
          ? { provider: "openai", apiKey: k, baseUrl, model: val("IMAGE_API_MODEL") ?? undefined, source: "env" }
          : null;
      },
      leonardo: () => {
        const k = val("LEONARDO_API_KEY");
        return k
          ? {
              provider: "leonardo",
              apiKey: k,
              baseUrl: val("LEONARDO_API_URL") ?? undefined,
              model: val("LEONARDO_MODEL_ID") ?? undefined,
              source: "env",
            }
          : null;
      },
      unsplash: () => {
        const k = val("UNSPLASH_ACCESS_KEY");
        return k
          ? {
              provider: "unsplash",
              apiKey: k,
              baseUrl: val("UNSPLASH_API_URL") ?? undefined,
              source: "env",
            }
          : null;
      },
    };
    const DEFAULT_IMAGE_ORDER = ["gemini", "openai", "leonardo", "unsplash"];
    const requested = (val("AI_IMAGE_PRIORITY") ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x in builders);
    const order = [...requested, ...DEFAULT_IMAGE_ORDER.filter((id) => !requested.includes(id))]
      // Unsplash returns a stock photograph, not a generated illustration, so
      // it is the safety net and stays last however the order is configured.
      .sort((a, b) => Number(a === "unsplash") - Number(b === "unsplash"));
    for (const id of order) {
      const key = builders[id]();
      if (key) out.push(key);
    }
    return out;
  }

  if (capability === "text") {
    // Each entry is built only when its key is present. The ORDER here is the
    // fallback order, and it matters a lot: the first provider that answers
    // wins, and a provider that is slow or sick delays everything behind it.
    // Override without a code change by setting AI_TEXT_PRIORITY to a comma
    // separated list of the ids below, e.g. "gemini,grok,openai".
    const builders: Record<string, () => ResolvedKey | null> = {
      grok: () => {
        // xAI Grok — OpenAI-compatible API (either env spelling works)
        const k = val("GROK_API_KEY") ?? val("Grok_API_KEY");
        return k
          ? { provider: "openai", apiKey: k, baseUrl: "https://api.x.ai/v1", model: val("GROK_MODEL") ?? "grok-2-latest", source: "env" }
          : null;
      },
      gemini: () => {
        const k = val("GEMINI_API_KEY");
        return k ? { provider: "gemini", apiKey: k, model: val("GEMINI_TEXT_MODEL") ?? undefined, source: "env" } : null;
      },
      anthropic: () => {
        const k = val("ANTHROPIC_API_KEY");
        return k ? { provider: "anthropic", apiKey: k, model: val("ANTHROPIC_MODEL") ?? undefined, source: "env" } : null;
      },
      openai: () => {
        const k = val("OPENAI_API_KEY");
        return k ? { provider: "openai", apiKey: k, source: "env" } : null;
      },
      deepseek: () => {
        const k = val("DEEPSEEK_API_KEY");
        return k ? { provider: "openai", apiKey: k, baseUrl: "https://api.deepseek.com/v1", model: val("DEEPSEEK_MODEL") ?? "deepseek-chat", source: "env" } : null;
      },
      openrouter: () => {
        const k = val("OPENROUTER_API_KEY");
        return k ? { provider: "openai", apiKey: k, baseUrl: "https://openrouter.ai/api/v1", model: val("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini", source: "env" } : null;
      },
      kimi: () => {
        const k = val("KIMI_API_KEY");
        // NOT moonshot-v1-8k: 8k is the TOTAL context (prompt + reply), and a
        // deck prompt alone measures ~3.5k tokens before the model writes a
        // word — that model could never answer a generation, only fail.
        return k ? { provider: "openai", apiKey: k, baseUrl: "https://api.moonshot.ai/v1", model: val("KIMI_MODEL") ?? "moonshot-v1-32k", source: "env" } : null;
      },
    };
    // Gemini leads by default; AI_TEXT_PRIORITY overrides without a deploy.
    const DEFAULT_ORDER = ["gemini", "kimi", "grok", "anthropic", "openai", "deepseek", "openrouter"];
    const requested = (val("AI_TEXT_PRIORITY") ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x in builders);
    const order = [...requested, ...DEFAULT_ORDER.filter((id) => !requested.includes(id))];
    for (const id of order) {
      const key = builders[id]();
      if (key) out.push(key);
    }
  }
  return out;
}

/**
 * Every key candidate for a capability in priority order:
 * user BYOK -> platform settings -> each .env key.
 */
async function resolveKeyCandidates(
  userId: number | undefined,
  capability: AiCapability,
): Promise<ResolvedKey[]> {
  const out: ResolvedKey[] = [];
  if (userId) {
    const rows = await getDb()
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.capability, capability)));
    if (rows.length > 0 && rows[0].apiKey.trim()) {
      out.push({
        provider: rows[0].provider,
        apiKey: rows[0].apiKey.trim(),
        source: "byok",
      });
    }
  }
  const settings = await getSettings();
  const platform = settings.platformAiKeys[capability];
  if (platform?.apiKey?.trim()) {
    out.push({
      provider: platform.provider,
      apiKey: platform.apiKey.trim(),
      baseUrl: platform.baseUrl,
      source: "platform",
    });
  }
  out.push(...envKeyCandidates(capability));
  return out;
}

/** Resolve the highest-priority key for a capability (BYOK -> platform -> .env). */
export async function resolveKey(
  userId: number | undefined,
  capability: AiCapability,
): Promise<ResolvedKey | null> {
  const candidates = await resolveKeyCandidates(userId, capability);
  return candidates[0] ?? null;
}

/** True when the user has any BYOK key for a capability (used by estimate). */
export async function userHasKey(userId: number, capability: AiCapability): Promise<boolean> {
  const rows = await getDb()
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.capability, capability)))
    .limit(1);
  return rows.length > 0;
}

/**
 * What one provider call returns. The token counts are what the Finance
 * expense tracker meters — they come from the provider's own accounting, so
 * spend is measured rather than guessed. `usage` is absent when a provider
 * does not report it.
 */
interface RawCompletion {
  text: string;
  model: string;
  usage?: { input: number; output: number };
}

async function callOpenAICompatible(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<RawCompletion> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
  // Per-route output ceilings. Moonshot/DeepSeek reject very large
  // max_tokens; gpt-4o-mini tops out at 16k.
  const cap = /deepseek|moonshot/.test(base) ? 8192 : 16384;
  maxTokens = Math.min(maxTokens, cap);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key.apiKey}`,
    },
    body: JSON.stringify({
      model: key.model || DEFAULT_MODELS.openai,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI-compatible API returned no content");
  return {
    text,
    model: key.model || DEFAULT_MODELS.openai,
    usage: data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

async function callAnthropic(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<RawCompletion> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.anthropic).replace(/\/$/, "");
  maxTokens = Math.min(maxTokens, 8192); // haiku's per-request output ceiling
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: key.model || DEFAULT_MODELS.anthropic,
      max_tokens: maxTokens,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic API returned no text");
  return {
    text,
    model: key.model || DEFAULT_MODELS.anthropic,
    usage: data.usage
      ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 }
      : undefined,
  };
}

async function callGemini(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<RawCompletion> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const models = key.model
    ? [key.model, ...GEMINI_TEXT_MODELS.filter((m) => m !== key.model)]
    : GEMINI_TEXT_MODELS;
  let lastError: Error | null = null;
  for (const model of models) {
    // Gemini 2.5 "thinks" before answering, and those thinking tokens are
    // billed against maxOutputTokens — on a long JSON deck the model can spend
    // the whole budget reasoning and return finishReason MAX_TOKENS with an
    // EMPTY body, which looks exactly like a dead provider. Turning thinking
    // off buys the deck instead of the monologue. Only 2.5 accepts the field:
    // older models reject the whole request with a 400, so never send it there.
    const supportsThinking = /gemini-2\.5/.test(model);
    const res = await fetch(
      `${base}/models/${model}:generateContent?key=${encodeURIComponent(key.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
            ...(supportsThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    // Any failure on ONE model is a reason to try the NEXT model, not to
    // abandon Gemini entirely. Previously only 404 fell through, so a single
    // 400 (unsupported field) or 429 (quota on that model) killed the whole
    // provider in milliseconds and looked like "no AI configured".
    if (!res.ok) {
      lastError = new Error(`Gemini API ${res.status} on ${model}: ${(await res.text()).slice(0, 200)}`);
      console.warn(`[ai/text] ${lastError.message} — trying next model`);
      continue;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") {
      console.warn(`[ai/text] gemini ${model} hit MAX_TOKENS — output likely truncated`);
    }
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) {
      // An empty body is a reason to try the next model too — a thinking model
      // that burned its budget may have a sibling that answers fine.
      lastError = new Error(
        `Gemini ${model} returned no content (finishReason: ${candidate?.finishReason ?? "unknown"})`,
      );
      console.warn(`[ai/text] ${lastError.message} — trying next model`);
      continue;
    }
    return {
      text,
      model,
      usage: data.usageMetadata
        ? {
            input: data.usageMetadata.promptTokenCount ?? 0,
            output: data.usageMetadata.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }
  throw lastError ?? new Error("No Gemini text model available");
}

/**
 * Run a text completion. Tries every configured key in priority order
 * (BYOK -> platform -> each .env key) and returns the first success, so one
 * invalid key or one provider outage doesn't take generation down. Returns
 * null only when no key is configured at all or every candidate failed —
 * callers decide whether that is a hard error or a mock fallback.
 */
export async function completeText(opts: {
  userId?: number;
  capability?: AiCapability;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  maxCandidates?: number;
  /** Shuffle the provider order (Fisher-Yates) so no single provider always
   *  answers first — the caller's own fallback (e.g. Wolfram) stays last
   *  because it only runs when every AI candidate has failed. */
  shuffleProviders?: boolean;
  /** Skip these resolvedKeyId()s — used to rotate providers without repeats. */
  excludeKeyIds?: string[];
  /** Pass an array to collect each candidate's failure reason, so a total
   *  failure can report WHICH provider refused and why. */
  collectErrors?: string[];
  /** Wall-clock ceiling for every candidate COMBINED. Without it each
   *  candidate gets the full timeoutMs, which can overrun the caller's own
   *  deadline; with it, the time is spent where it does the most good. */
  budgetMs?: number;
}): Promise<CompletionResult | null> {
  const capability = opts.capability ?? "text";
  let candidates = await resolveKeyCandidates(opts.userId, capability);
  if (opts.excludeKeyIds?.length) {
    const skip = new Set(opts.excludeKeyIds);
    const kept = candidates.filter((k) => !skip.has(resolvedKeyId(k)));
    // if everything is excluded, the rotation has completed — start over
    if (kept.length > 0) candidates = kept;
  }
  if (opts.shuffleProviders) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  }
  if (candidates.length === 0) {
    console.warn(`[ai/text] no ${capability} key configured (BYOK, platform, or .env)`);
    return null;
  }

  const maxTokens = opts.maxTokens ?? 4096;
  const timeoutMs = Math.max(2_000, opts.timeoutMs ?? Number(process.env.AI_TEXT_TIMEOUT_MS ?? 25_000));
  const keys = orderForDiversity(candidates).slice(
    0,
    Math.max(1, opts.maxCandidates ?? candidates.length),
  );
  /**
   * Wall-clock ceiling for ALL candidates together, rather than a fixed slice
   * each. Dividing the budget evenly is what turned one slow success into two
   * guaranteed failures: a deck is ~5.5k output tokens, which takes a provider
   * 35-55s to produce, so two 26s tries could not finish even though a single
   * longer one would have. Now the first candidate may use most of the budget,
   * and a candidate that fails FAST (bad key, 400, refusal) leaves the rest of
   * the time to the next one — which is when a fallback is actually useful.
   */
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : null;

  for (const key of keys) {
    const slice = nextSlice(timeoutMs, deadline, Date.now());
    if (slice === null) {
      const left = Math.max(0, Math.round(((deadline ?? 0) - Date.now()) / 1000));
      const msg = `skipped — only ${left}s of the time budget left`;
      opts.collectErrors?.push(`${key.provider} (${key.source}): ${msg}`);
      console.warn(`[ai/text] ${key.provider} (${key.source}) ${msg}`);
      break;
    }
    try {
      let out: RawCompletion;
      switch (key.provider) {
        case "openai":
          out = await callOpenAICompatible(key, opts.messages, maxTokens, slice);
          break;
        case "anthropic":
          out = await callAnthropic(key, opts.messages, maxTokens, slice);
          break;
        case "gemini":
          out = await callGemini(key, opts.messages, maxTokens, slice);
          break;
        default:
          continue; // e.g. an elevenlabs (tts-only) key can't do text
      }
      // Finance expense tracker. Awaited on purpose: a stray promise cannot be
      // left running here — a serverless invocation stays open until it
      // settles, so a slow bookkeeping write could outlive the deck it was
      // measuring and take the whole request down with it. recordAiUsage
      // bounds its own time and swallows its own errors, so the worst case is
      // an unrecorded call, never a lost generation.
      if (out.usage) await recordAiUsage(key, out.model, out.usage);
      return { text: out.text, provider: key.provider, source: key.source, keyId: resolvedKeyId(key) };
    } catch (err) {
      // Bad key, quota, timeout, unreachable host — log and try the next key.
      const detail = err instanceof Error ? err.message : String(err);
      const label = `${key.provider}${key.model ? `/${key.model}` : ""} (${key.source})`;
      opts.collectErrors?.push(`${label}: ${detail.slice(0, 160)}`);
      console.warn(`[ai/text] ${label} failed, trying next candidate:`, detail);
    }
  }
  console.warn(`[ai/text] all ${keys.length} ${capability} key candidate(s) failed`);
  return null;
}

/* ------------------------------------------------------------------ */
/* Web search: fetch CURRENT facts so generations about real products,  */
/* news, etc. are accurate. Uses Gemini's Google-Search grounding or an  */
/* OpenRouter ":online" model — providers without a web path are skipped.*/

async function callGeminiGrounded(key: ResolvedKey, prompt: string): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
  const models = key.model
    ? [key.model, ...GEMINI_TEXT_MODELS.filter((m) => m !== key.model)]
    : GEMINI_TEXT_MODELS;
  let notFound: Error | null = null;
  for (const model of models) {
    const res = await fetch(
      `${base}/models/${model}:generateContent?key=${encodeURIComponent(key.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 1200 },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (res.status === 404) {
      notFound = new Error(`Gemini model ${model} not found`);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini grounding ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (text) return text;
    throw new Error("Gemini grounding returned no content");
  }
  throw notFound ?? new Error("No Gemini model available for grounding");
}

async function callOpenRouterOnline(key: ResolvedKey, prompt: string): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
  const model = `${key.model || "openai/gpt-4o-mini"}:online`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenRouter online ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter online returned no content");
  return text;
}

/**
 * Search the web for current facts about `query` and return concise notes, or
 * null when no web-capable provider is configured (a Gemini key or an
 * OpenRouter key). The notes are meant to be injected as reference material
 * into a normal (JSON) generation — search never runs on the JSON call itself.
 */
export async function webResearch(
  userId: number | undefined,
  query: string,
): Promise<{ text: string; provider: AiProvider } | null> {
  const candidates = await resolveKeyCandidates(userId, "text").catch(() => [] as ResolvedKey[]);
  const prompt = `Search the web for CURRENT, ACCURATE information about: ${query}

Return concise factual notes an author can rely on for an accurate presentation: real specifications, genuine features, what it CAN and CANNOT do, price range if relevant, release date, and common misconceptions to correct. Plain-text bullet points only. Omit anything you cannot verify.`;
  for (const key of candidates) {
    try {
      if (key.provider === "gemini") {
        const text = await callGeminiGrounded(key, prompt);
        if (text.trim()) return { text: text.trim(), provider: "gemini" };
      } else if (key.provider === "openai" && /openrouter\.ai/.test(key.baseUrl ?? "")) {
        const text = await callOpenRouterOnline(key, prompt);
        if (text.trim()) return { text: text.trim(), provider: "openai" };
      }
      // providers without a web-search path are skipped
    } catch (err) {
      console.warn(
        `[ai/web] ${key.provider} search failed, trying next:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Vision: read image(s) + a prompt and return text. Used to grade a    */
/* handwritten worked solution on the scratchpad. Uses the TEXT keys     */
/* (the same models accept images); providers without vision are skipped */
/* ------------------------------------------------------------------ */

export interface VisionImage {
  /** e.g. "image/png" */
  mime: string;
  /** base64 payload WITHOUT the data: prefix */
  b64: string;
}

async function callGeminiVision(
  key: ResolvedKey,
  system: string,
  userText: string,
  images: VisionImage[],
  maxTokens: number,
): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
  const parts = [
    { text: userText },
    ...images.map((im) => ({ inlineData: { mimeType: im.mime, data: im.b64 } })),
  ];
  const models = key.model
    ? [key.model, ...GEMINI_TEXT_MODELS.filter((m) => m !== key.model)]
    : GEMINI_TEXT_MODELS;
  let notFound: Error | null = null;
  for (const model of models) {
    const res = await fetch(
      `${base}/models/${model}:generateContent?key=${encodeURIComponent(key.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (res.status === 404) {
      notFound = new Error(`Gemini model ${model} not found (404)`);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new Error("Gemini vision returned no content");
    return text;
  }
  throw notFound ?? new Error("No Gemini vision model available");
}

async function callOpenAIVision(
  key: ResolvedKey,
  system: string,
  userText: string,
  images: VisionImage[],
  maxTokens: number,
): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key.apiKey}` },
    body: JSON.stringify({
      model: key.model || "gpt-4o-mini",
      max_tokens: Math.min(maxTokens, 16384),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...images.map((im) => ({
              type: "image_url",
              image_url: { url: `data:${im.mime};base64,${im.b64}` },
            })),
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI vision returned no content");
  return text;
}

async function callAnthropicVision(
  key: ResolvedKey,
  system: string,
  userText: string,
  images: VisionImage[],
  maxTokens: number,
): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.anthropic).replace(/\/$/, "");
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: key.model || DEFAULT_MODELS.anthropic,
      max_tokens: Math.min(maxTokens, 8192),
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...images.map((im) => ({
              type: "image",
              source: { type: "base64", media_type: im.mime, data: im.b64 },
            })),
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Anthropic vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic vision returned no text");
  return text;
}

/**
 * Vision completion: send image(s) + a prompt, get text back. Cascades the
 * text keys (all three providers accept images). Returns null when no key
 * works, so the caller can fall back.
 */
export async function completeVision(opts: {
  userId?: number;
  system: string;
  userText: string;
  images: VisionImage[];
  maxTokens?: number;
}): Promise<CompletionResult | null> {
  const candidates = await resolveKeyCandidates(opts.userId, "text");
  if (candidates.length === 0) return null;
  const maxTokens = opts.maxTokens ?? 500;
  for (const key of candidates) {
    try {
      let text: string;
      switch (key.provider) {
        case "gemini":
          text = await callGeminiVision(key, opts.system, opts.userText, opts.images, maxTokens);
          break;
        case "openai":
          text = await callOpenAIVision(key, opts.system, opts.userText, opts.images, maxTokens);
          break;
        case "anthropic":
          text = await callAnthropicVision(key, opts.system, opts.userText, opts.images, maxTokens);
          break;
        default:
          continue; // an elevenlabs (tts-only) key can't do vision
      }
      return { text, provider: key.provider, source: key.source, keyId: resolvedKeyId(key) };
    } catch (err) {
      console.warn(
        `[ai/vision] ${key.provider} (${key.source}) failed, trying next:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

export interface ProviderDiagnosis {
  provider: ImageProvider;
  source: "byok" | "platform" | "env";
  model: string | null;
  endpoint: string | null;
  ok: boolean;
  ms: number;
  error: string | null;
}

/**
 * Ping every configured TEXT provider, in parallel, with a real (tiny)
 * generation. This is the answer to "generation failed but I can't see why":
 * it names each key the server would actually use and reports whether it
 * answers, how fast, and the exact error when it doesn't.
 */
export async function diagnoseTextProviders(
  userId?: number,
  timeoutMs = 12_000,
): Promise<ProviderDiagnosis[]> {
  const candidates = await resolveKeyCandidates(userId, "text").catch(() => [] as ResolvedKey[]);
  const messages: ChatMessage[] = [
    { role: "system", content: 'Reply with only this JSON: {"ok":true}' },
    { role: "user", content: "ping" },
  ];
  return Promise.all(
    candidates.map(async (key): Promise<ProviderDiagnosis> => {
      const at = Date.now();
      const base: Omit<ProviderDiagnosis, "ok" | "ms" | "error"> = {
        provider: key.provider,
        source: key.source,
        model: key.model ?? DEFAULT_MODELS[key.provider as TextProvider] ?? null,
        endpoint: key.baseUrl ?? null,
      };
      try {
        switch (key.provider) {
          case "openai":
            await callOpenAICompatible(key, messages, 16, timeoutMs);
            break;
          case "anthropic":
            await callAnthropic(key, messages, 16, timeoutMs);
            break;
          case "gemini":
            await callGemini(key, messages, 16, timeoutMs);
            break;
          default:
            throw new Error("not a text provider");
        }
        return { ...base, ok: true, ms: Date.now() - at, error: null };
      } catch (err) {
        return {
          ...base,
          ok: false,
          ms: Date.now() - at,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 240),
        };
      }
    }),
  );
}

/**
 * Minimal provider ping used by keys.test. Text/tts keys get a one-token
 * round trip; image keys get a cheap endpoint check against the image model
 * (model metadata lookup — no paid generation).
 */
export async function testKey(
  provider: AiProvider,
  apiKey: string,
  baseUrl?: string,
  capability: AiCapability = "text",
): Promise<void> {
  if (capability === "image") {
    switch (provider) {
      case "gemini": {
        const base = (baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
        const res = await fetch(`${base}/models/${GEMINI_IMAGE_MODELS[0]}`, {
          headers: { "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok)
          throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
      }
      case "openai": {
        const base = (baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
        const res = await fetch(`${base}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok)
          throw new Error(`OpenAI-compatible API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
      }
      case "anthropic":
        throw new Error("Anthropic has no image generation API");
    }
  }
  if (capability === "tts" || provider === "elevenlabs") {
    // ElevenLabs: a cheap authenticated GET verifies the key without spending
    // characters on synthesis.
    const base = (baseUrl || ELEVENLABS_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${base}/voices`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
      throw new Error(`ElevenLabs API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const key: ResolvedKey = { provider, apiKey, baseUrl, source: "byok" };
  const messages: ChatMessage[] = [
    { role: "system", content: 'Reply with exactly: {"ok":true}' },
    { role: "user", content: "ping" },
  ];
  switch (provider) {
    case "openai":
      await callOpenAICompatible(key, messages, 16, 30_000);
      return;
    case "anthropic":
      await callAnthropic(key, messages, 16, 30_000);
      return;
    case "gemini":
      await callGemini(key, messages, 16, 30_000);
      return;
    default:
      throw new Error(`Provider ${provider} cannot be tested for ${capability}`);
  }
}

/* ------------------------------------------------------------------ */
/* Text-to-speech (ElevenLabs). Reads a paragraph aloud on demand from  */
/* the player. BYOK-only: an ElevenLabs key stored under the "tts"       */
/* capability. No platform/.env fallback and no token accounting — the   */
/* user pays ElevenLabs directly, so nothing here touches coins/tickets. */
/* ------------------------------------------------------------------ */

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
/** Rachel — a stable default voice when the user hasn't picked one. */
export const DEFAULT_TTS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/** Resolve the user's ElevenLabs BYOK key (capability "tts"), or null. */
async function resolveElevenLabsKey(userId: number | undefined): Promise<string | null> {
  if (!userId) return null;
  const rows = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.capability, "tts")))
    .limit(1);
  const row = rows[0];
  if (!row || row.provider !== "elevenlabs" || !row.apiKey.trim()) return null;
  return row.apiKey.trim();
}

/** True when the user has an ElevenLabs TTS key configured. */
export async function userHasTts(userId: number | undefined): Promise<boolean> {
  return (await resolveElevenLabsKey(userId)) !== null;
}

export interface TtsVoice {
  id: string;
  name: string;
}

/** List the user's available ElevenLabs voices, or [] when none/no key. */
export async function listTtsVoices(userId: number | undefined): Promise<TtsVoice[]> {
  const apiKey = await resolveElevenLabsKey(userId).catch(() => null);
  if (!apiKey) return [];
  try {
    const res = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { voices?: { voice_id: string; name?: string }[] };
    return (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name || v.voice_id }));
  } catch {
    return [];
  }
}

/**
 * Synthesize `text` to speech and return an audio data URI (base64 MP3), or
 * null when no ElevenLabs key is configured or the call fails. Text is capped
 * so a single paragraph read stays a cheap request.
 */
export async function ttsSpeak(opts: {
  userId?: number;
  text: string;
  voiceId?: string;
}): Promise<{ audio: string; mime: string } | null> {
  const apiKey = await resolveElevenLabsKey(opts.userId).catch(() => null);
  if (!apiKey) return null;
  const text = opts.text.trim().slice(0, 2500);
  if (!text) return null;
  const voiceId = opts.voiceId?.trim() || DEFAULT_TTS_VOICE_ID;
  try {
    const res = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[ai/tts] ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { audio: `data:audio/mpeg;base64,${buf.toString("base64")}`, mime: "audio/mpeg" };
  } catch (err) {
    console.warn("[ai/tts] ElevenLabs request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Image generation. Returns a base64 data URI, or null on ANY failure  */
/* (no key configured, provider error, unsupported provider) — callers  */
/* always keep the style-thumbnail fallback. Keys never leave the server */
/* ------------------------------------------------------------------ */

const IMAGE_STYLE_DIRECTIVES: Record<string, string> = {
  sketch: "hand-drawn pencil sketch on warm cream paper, ink outlines, minimal color",
  watercolor: "loose warm watercolor on paper",
  flat: "flat vector illustration, bold ink outlines, warm palette",
  photo: "warm editorial photograph, soft daylight",
};

/** "Nano banana" = Gemini 2.5 Flash Image; fall back on 404. */
const GEMINI_IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
];

async function callGeminiImage(key: ResolvedKey, prompt: string): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
  let lastError: Error | null = null;
  const models = key.model ? [key.model, ...GEMINI_IMAGE_MODELS] : GEMINI_IMAGE_MODELS;
  for (const model of models) {
    const res = await fetch(`${base}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    // As with text: one unhappy model means try the next model, not abandon
    // Gemini. A 400 or 429 on the first entry used to kill image generation
    // outright even though a sibling model would have answered.
    if (!res.ok) {
      lastError = new Error(
        `Gemini image API ${res.status} on ${model}: ${(await res.text()).slice(0, 200)}`,
      );
      continue;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    };
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) {
      lastError = new Error(`Gemini image model ${model} returned no image data`);
      continue;
    }
    return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
  }
  throw lastError ?? new Error("No Gemini image model available");
}

/** Fetch a remote image URL and inline it, so decks stay self-contained. */
async function urlToDataUri(url: string, timeoutMs = 30_000): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`image download ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const LEONARDO_BASE_URL = "https://cloud.leonardo.ai/api/rest/v1";
const UNSPLASH_BASE_URL = "https://api.unsplash.com";
/** Leonardo Phoenix — a good general-purpose default when none is configured. */
const LEONARDO_DEFAULT_MODEL = "6b645e3a-d64f-4341-a6d8-7a3690fbf042";

/**
 * Leonardo generates asynchronously: the POST returns a job id and the image
 * appears some seconds later, so this polls. The whole thing is bounded well
 * under the serverless ceiling — a slow picture must never cost the deck.
 */
async function callLeonardoImage(key: ResolvedKey, prompt: string): Promise<string> {
  const base = (key.baseUrl || LEONARDO_BASE_URL).replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${key.apiKey}`,
  };
  const start = await fetch(`${base}/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: prompt.slice(0, 1400),
      modelId: key.model || LEONARDO_DEFAULT_MODEL,
      num_images: 1,
      width: 1024,
      height: 768,
      alchemy: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!start.ok) {
    throw new Error(`Leonardo API ${start.status}: ${(await start.text()).slice(0, 200)}`);
  }
  const job = (await start.json()) as { sdGenerationJob?: { generationId?: string } };
  const id = job.sdGenerationJob?.generationId;
  if (!id) throw new Error("Leonardo API returned no generation id");

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_500));
    const poll = await fetch(`${base}/generations/${id}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!poll.ok) continue;
    const data = (await poll.json()) as {
      generations_by_pk?: { status?: string; generated_images?: { url?: string }[] };
    };
    const gen = data.generations_by_pk;
    if (gen?.status === "FAILED") throw new Error("Leonardo generation failed");
    const url = gen?.generated_images?.[0]?.url;
    if (gen?.status === "COMPLETE" && url) return await urlToDataUri(url);
  }
  throw new Error("Leonardo generation timed out");
}

/**
 * Last resort: a real photograph from Unsplash. This is a SEARCH, not a
 * generation, so it gets the bare subject rather than the full art-direction
 * prompt — style directives would match nothing.
 */
async function fetchUnsplashImage(key: ResolvedKey, query: string): Promise<string> {
  const terms = query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  const base = (key.baseUrl || UNSPLASH_BASE_URL).replace(/\/$/, "");
  const url =
    `${base}/search/photos?per_page=1&orientation=landscape` +
    `&query=${encodeURIComponent(terms || query.slice(0, 80))}`;
  const res = await fetch(url, {
    headers: { authorization: `Client-ID ${key.apiKey}`, "accept-version": "v1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Unsplash API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    results?: { urls?: { regular?: string }; links?: { download_location?: string } }[];
  };
  const hit = data.results?.[0];
  const photo = hit?.urls?.regular;
  if (!photo) throw new Error(`Unsplash had no photo for "${terms}"`);
  // Unsplash's API terms require pinging download_location when a photo is
  // actually used. Best effort — never let it block or fail the image.
  if (hit?.links?.download_location) {
    await fetch(hit.links.download_location, {
      headers: { authorization: `Client-ID ${key.apiKey}` },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  }
  return await urlToDataUri(photo);
}

async function callOpenAIImage(key: ResolvedKey, prompt: string): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
  const request = (body: Record<string, unknown>) =>
    fetch(`${base}/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

  let res = await request({
    model: key.model || "gpt-image-1",
    prompt,
    size: "1024x1024",
    response_format: "b64_json",
  });
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    // model/param rejected — retry dall-e-3 (no response_format param)
    res = await request({ model: "dall-e-3", prompt, size: "1024x1024" });
  }
  if (!res.ok)
    throw new Error(`OpenAI image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = data.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`OpenAI image URL fetch failed: ${img.status}`);
    const mime = img.headers.get("content-type")?.split(";")[0] || "image/png";
    const buf = Buffer.from(await img.arrayBuffer());
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  throw new Error("OpenAI image API returned no image");
}

/**
 * Generate one image for a slide. Returns a `data:image/...;base64,...` URI,
 * or null when no image key is configured or the call fails (reason logged
 * server-side). Style directive is prepended to keep the SketchLearn look.
 */
/**
 * Which provider WOULD serve a capability for this user (BYOK → platform →
 * env). Used to attribute generated content ("images by gemini") without
 * threading provenance through every call.
 */
export async function resolveProviderName(
  userId: number | undefined,
  capability: AiCapability,
): Promise<ImageProvider | null> {
  const candidates = await resolveKeyCandidates(userId, capability).catch(() => [] as ResolvedKey[]);
  return candidates[0]?.provider ?? null;
}

/**
 * Same as generateImage, but also reports WHICH source actually served the
 * picture. The cascade means that is often not the first candidate, and
 * Unsplash in particular has to be credited accurately — saying "Gemini" over
 * a stock photograph would be a false credit, not just a cosmetic slip.
 */
export async function generateImageDetailed(opts: {
  userId?: number;
  prompt: string;
  style?: string;
}): Promise<{ url: string; provider: ImageProvider } | null> {
  const candidates = await resolveKeyCandidates(opts.userId, "image").catch(() => [] as ResolvedKey[]);
  if (candidates.length === 0) return null;
  const directive = opts.style ? IMAGE_STYLE_DIRECTIVES[opts.style] : undefined;
  const prompt = directive ? `${opts.prompt}\n\nStyle: ${directive}.` : opts.prompt;
  for (const key of candidates) {
    try {
      switch (key.provider) {
        case "gemini":
          return { url: await callGeminiImage(key, prompt), provider: "gemini" };
        case "openai":
          return { url: await callOpenAIImage(key, prompt), provider: "openai" };
        case "leonardo":
          return { url: await callLeonardoImage(key, prompt), provider: "leonardo" };
        case "unsplash":
          // Searches for the subject, so it gets the un-art-directed prompt.
          return { url: await fetchUnsplashImage(key, opts.prompt), provider: "unsplash" };
        case "anthropic":
        case "elevenlabs":
          continue; // no image API
      }
    } catch (err) {
      console.warn(
        `[ai/image] ${key.provider} (${key.source}) failed, trying next candidate:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.warn(`[ai/image] all ${candidates.length} image candidate(s) failed`);
  return null;
}

/** Convenience wrapper for callers that only need the picture itself. */
export async function generateImage(opts: {
  userId?: number;
  prompt: string;
  style?: string;
}): Promise<string | null> {
  return (await generateImageDetailed(opts))?.url ?? null;
}
