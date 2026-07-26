import { getDb } from "../queries/connection.js";
import { apiKeys } from "../../db/schema.js";
import { and, eq } from "drizzle-orm";
import { getSettings } from "../settings.js";
import type { AiCapability, AiProvider } from "../../contracts/types.js";

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
  provider: AiProvider;
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
}

/** Providers with a chat/completion API (ElevenLabs is speech-only). */
type TextProvider = Exclude<AiProvider, "elevenlabs">;

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
    const gemini = val("GEMINI_API_KEY");
    if (gemini) {
      out.push({ provider: "gemini", apiKey: gemini, model: val("GEMINI_IMAGE_MODEL") ?? undefined, source: "env" });
    }
    const imageKey = val("IMAGE_API_KEY") ?? val("OPENAI_API_KEY");
    if (imageKey) {
      // IMAGE_API_URL may be the full endpoint; callers append /images/generations.
      const baseUrl = val("IMAGE_API_URL")?.replace(/\/images\/generations\/?$/, "") ?? undefined;
      out.push({ provider: "openai", apiKey: imageKey, baseUrl, model: val("IMAGE_API_MODEL") ?? undefined, source: "env" });
    }
    return out;
  }

  if (capability === "text") {
    const gemini = val("GEMINI_API_KEY");
    if (gemini) {
      out.push({ provider: "gemini", apiKey: gemini, model: val("GEMINI_TEXT_MODEL") ?? undefined, source: "env" });
    }
    const anthropic = val("ANTHROPIC_API_KEY");
    if (anthropic) {
      out.push({ provider: "anthropic", apiKey: anthropic, model: val("ANTHROPIC_MODEL") ?? undefined, source: "env" });
    }
    const openai = val("OPENAI_API_KEY");
    if (openai) out.push({ provider: "openai", apiKey: openai, source: "env" });
    const deepseek = val("DEEPSEEK_API_KEY");
    if (deepseek) {
      out.push({ provider: "openai", apiKey: deepseek, baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", source: "env" });
    }
    const openrouter = val("OPENROUTER_API_KEY");
    if (openrouter) {
      out.push({ provider: "openai", apiKey: openrouter, baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", source: "env" });
    }
    const kimi = val("KIMI_API_KEY");
    if (kimi) {
      out.push({ provider: "openai", apiKey: kimi, baseUrl: "https://api.moonshot.ai/v1", model: "moonshot-v1-8k", source: "env" });
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

async function callOpenAICompatible(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
  // DeepSeek/Moonshot reject max_tokens above 8k; gpt-4o-mini tops out at 16k.
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
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI-compatible API returned no content");
  return text;
}

async function callAnthropic(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
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
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic API returned no text");
  return text;
}

async function callGemini(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
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
  let notFound: Error | null = null;
  for (const model of models) {
    const res = await fetch(
      `${base}/models/${model}:generateContent?key=${encodeURIComponent(key.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (res.status === 404) {
      notFound = new Error(`Gemini model ${model} not found (404)`);
      console.warn(`[ai/text] gemini model ${model} not found, trying next model`);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") {
      console.warn(`[ai/text] gemini ${model} hit MAX_TOKENS — output likely truncated`);
    }
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new Error("Gemini API returned no content");
    return text;
  }
  throw notFound ?? new Error("No Gemini text model available");
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
}): Promise<CompletionResult | null> {
  const capability = opts.capability ?? "text";
  const candidates = await resolveKeyCandidates(opts.userId, capability);
  if (candidates.length === 0) {
    console.warn(`[ai/text] no ${capability} key configured (BYOK, platform, or .env)`);
    return null;
  }

  const maxTokens = opts.maxTokens ?? 4096;
  const timeoutMs = Math.max(2_000, opts.timeoutMs ?? Number(process.env.AI_TEXT_TIMEOUT_MS ?? 25_000));
  const keys = candidates.slice(0, Math.max(1, opts.maxCandidates ?? candidates.length));
  for (const key of keys) {
    try {
      let text: string;
      switch (key.provider) {
        case "openai":
          text = await callOpenAICompatible(key, opts.messages, maxTokens, timeoutMs);
          break;
        case "anthropic":
          text = await callAnthropic(key, opts.messages, maxTokens, timeoutMs);
          break;
        case "gemini":
          text = await callGemini(key, opts.messages, maxTokens, timeoutMs);
          break;
        default:
          continue; // e.g. an elevenlabs (tts-only) key can't do text
      }
      return { text, provider: key.provider, source: key.source };
    } catch (err) {
      // Bad key, quota, timeout, unreachable host — log and try the next key.
      console.warn(
        `[ai/text] ${key.provider} (${key.source}${key.model ? `, ${key.model}` : ""}) failed, trying next candidate:`,
        err instanceof Error ? err.message : err,
      );
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
      return { text, provider: key.provider, source: key.source };
    } catch (err) {
      console.warn(
        `[ai/vision] ${key.provider} (${key.source}) failed, trying next:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
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
  let notFound: Error | null = null;
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
    if (res.status === 404) {
      notFound = new Error(`Gemini image model ${model} not found (404)`);
      continue;
    }
    if (!res.ok)
      throw new Error(`Gemini image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    };
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("Gemini image API returned no image data");
    return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
  }
  throw notFound ?? new Error("No Gemini image model available");
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
): Promise<AiProvider | null> {
  const candidates = await resolveKeyCandidates(userId, capability).catch(() => [] as ResolvedKey[]);
  return candidates[0]?.provider ?? null;
}

export async function generateImage(opts: {
  userId?: number;
  prompt: string;
  style?: string;
}): Promise<string | null> {
  const candidates = await resolveKeyCandidates(opts.userId, "image").catch(() => [] as ResolvedKey[]);
  if (candidates.length === 0) return null;
  const directive = opts.style ? IMAGE_STYLE_DIRECTIVES[opts.style] : undefined;
  const prompt = directive ? `${opts.prompt}\n\nStyle: ${directive}.` : opts.prompt;
  for (const key of candidates) {
    try {
      switch (key.provider) {
        case "gemini":
          return await callGeminiImage(key, prompt);
        case "openai":
          return await callOpenAIImage(key, prompt);
        case "anthropic":
          console.warn("[ai/image] Anthropic has no image generation API — skipping");
          continue;
      }
    } catch (err) {
      console.warn(
        `[ai/image] ${key.provider} (${key.source}) failed, trying next candidate:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}
