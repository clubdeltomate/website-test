import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ExternalLink, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import Chip from '@/components/sketch/Chip';
import StickyNote from '@/components/sketch/StickyNote';
import WashiTape from '@/components/sketch/WashiTape';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import CountUp from '@/components/admin/CountUp';
import {
  LabeledField,
  SketchInput,
  SketchSelect,
  SketchTabs,
  SketchToggle,
  SkeletonBlock,
} from '@/components/admin/controls';
import { errMsg, formatMoney } from '@/components/admin/utils';
import type { AiCapability, AiProvider, AppSettings, Level, TokenPack } from '@contracts/types';
import { say } from '@/lib/i18n';

const TABS = [
  { id: 'pricing', label: 'Pricing' },
  { id: 'payments', label: 'Payments' },
  { id: 'providers', label: 'AI providers' },
  { id: 'flags', label: 'Feature flags' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PROVIDERS: AiProvider[] = ['openai', 'anthropic', 'gemini'];
const CAP_META: { id: AiCapability; label: string; helper: string }[] = [
  { id: 'text', label: 'Text ✍️', helper: 'Powers deck prose and the Coach.' },
  { id: 'image', label: 'Images 🖼️', helper: 'Powers generated slide illustrations.' },
  { id: 'tts', label: 'Speech 🔊', helper: 'Powers provider read-aloud (when enabled).' },
];

const LEVEL_LABEL: Record<Level, string> = {
  A0: 'A0',
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
};

/* ------------------------------------------------------------------ */
/* Tab 1 — Pricing + live calculator                                   */
/* ------------------------------------------------------------------ */

function NumberStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  ariaLabel?: string;
}) {
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    <div className="flex items-center gap-2">
      <SketchButton
        variant="secondary"
        size="icon"
        aria-label={say("decrease")}
        onClick={() => onChange(Math.max(min, round(value - step)))}
      >
        −
      </SketchButton>
      <input
        type="number"
        aria-label={ariaLabel}
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        className="w-24 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1.5 text-center font-mono font-bold text-ink focus:border-blue focus:outline-none"
      />
      <SketchButton
        variant="secondary"
        size="icon"
        aria-label={say("increase")}
        onClick={() => onChange(round(value + step))}
      >
        +
      </SketchButton>
    </div>
  );
}

function PricingTab({
  draft,
  patch,
}: {
  draft: AppSettings;
  patch: (p: Partial<AppSettings>) => void;
}) {
  const [calcSlides, setCalcSlides] = useState(8);
  const [calcLevel, setCalcLevel] = useState<Level>('B1');
  const [calcImages, setCalcImages] = useState(true);
  const [calcTts, setCalcTts] = useState(false);

  const p = draft.prices;
  const setPrices = (pr: Partial<AppSettings['prices']>) =>
    patch({ prices: { ...p, ...pr } });

  const base = p.perSlideBase * calcSlides;
  const imageCost = calcImages ? p.perImageSlide * calcSlides : 0;
  const ttsCost = calcTts ? p.perTts * calcSlides : 0;
  const mult = p.levelMultiplier[calcLevel];
  const total = Math.round((base + imageCost + ttsCost) * mult * 10) / 10;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <SketchCard className="relative">
        <WashiTape rotate={-3} />
        <h3 className="mb-4 font-heading text-lg font-semibold text-ink">{say("Generation prices 🪙")}</h3>
        <div className="flex flex-col divide-y-2 divide-dashed divide-pencil">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-heading font-semibold text-ink">{say("Base cost per slide")}</p>
              <p className="text-xs text-ink-faint">{say("Charged for every generated slide.")}</p>
            </div>
            <NumberStepper
              value={p.perSlideBase}
              step={0.2}
              ariaLabel="Base cost per slide"
              onChange={(v) => setPrices({ perSlideBase: v })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-heading font-semibold text-ink">{say("Generated image")}</p>
              <p className="text-xs text-ink-faint">{say("Extra per slide with an image component.")}</p>
            </div>
            <NumberStepper
              value={p.perImageSlide}
              step={0.5}
              ariaLabel="Per image slide"
              onChange={(v) => setPrices({ perImageSlide: v })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-heading font-semibold text-ink">{say("TTS read-aloud")}</p>
              <p className="text-xs text-ink-faint">{say("Extra per slide narrated by a provider.")}</p>
            </div>
            <NumberStepper
              value={p.perTts}
              step={0.5}
              ariaLabel="Per TTS slide"
              onChange={(v) => setPrices({ perTts: v })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-heading font-semibold text-ink">{say("Post music")}</p>
              <p className="text-xs text-ink-faint">
                
                {say("Per 30 seconds of ElevenLabs music on a marketing post; longer clips scale from it. Charged to everyone, admins included.")}
              </p>
            </div>
            <NumberStepper
              value={p.perMusic ?? 20}
              step={1}
              ariaLabel="Per music clip"
              onChange={(v) => setPrices({ perMusic: v })}
            />
          </div>
          <div className="py-3">
            <p className="font-heading font-semibold text-ink">{say("Level multipliers")}</p>
            <p className="mb-2 text-xs text-ink-faint">{say("Applied to the whole estimate.")}</p>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(LEVEL_LABEL) as Level[]).map((lvl) => (
                <label key={lvl} className="flex items-center gap-1.5 text-sm font-bold text-ink-soft">
                  {LEVEL_LABEL[lvl]} ×
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={p.levelMultiplier[lvl]}
                    aria-label={`${LEVEL_LABEL[lvl]} multiplier`}
                    onChange={(e) =>
                      setPrices({
                        levelMultiplier: {
                          ...p.levelMultiplier,
                          [lvl]: Math.max(0, Number(e.target.value) || 0),
                        },
                      })
                    }
                    className="w-20 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-center font-mono font-bold text-ink focus:border-blue focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
        <p className="micro mt-3 text-ink-faint">
          
          {say("Edits apply to new generations only — estimates shown to users update immediately.")}
        </p>
      </SketchCard>

      {/* live calculator */}
      <motion.div
        initial={{ rotate: 4, opacity: 0 }}
        animate={{ rotate: -1.5, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="lg:sticky lg:top-20 lg:self-start"
      >
        <StickyNote rotate={0}>
          <p className="mb-3 font-heading text-lg font-semibold">{say("Live calculator")}</p>
          <div className="flex flex-col gap-3 text-[0.95rem]">
            <label className="flex items-center justify-between gap-3">
              
              {say("Slides")}
              <span className="flex items-center gap-2">
                <input
                  type="range"
                  min={4}
                  max={15}
                  value={calcSlides}
                  onChange={(e) => setCalcSlides(Number(e.target.value))}
                  className="h-2 w-28 cursor-pointer appearance-none rounded-full border-2 border-ink bg-paper-3 accent-[#2E2820]"
                  aria-label={say("Calculator slides")}
                />
                <span className="w-6 text-center font-mono font-bold">{calcSlides}</span>
              </span>
            </label>
            <div className="flex items-center justify-between gap-2">
              
              {say("Level")}
              <span className="flex gap-1.5">
                {(Object.keys(LEVEL_LABEL) as Level[]).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setCalcLevel(lvl)}
                    className={
                      calcLevel === lvl
                        ? 'rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-0.5 text-xs font-bold text-ink'
                        : 'rounded-wobble-sm border-2 border-dashed border-ink/40 px-2 py-0.5 text-xs font-bold text-ink/60'
                    }
                  >
                    {LEVEL_LABEL[lvl].slice(0, 4)}.
                  </button>
                ))}
              </span>
            </div>
            <div className="flex items-center justify-between">
              
              {say("Images")}
              <SketchToggle label="Calculator images" checked={calcImages} onChange={setCalcImages} />
            </div>
            <div className="flex items-center justify-between">
              
              {say("TTS")}
              <SketchToggle label="Calculator TTS" checked={calcTts} onChange={setCalcTts} />
            </div>
          </div>
          <div className="mt-4 border-t-2 border-dashed border-ink/30 pt-3">
            <p className="font-display text-5xl font-bold leading-none">
              ≈ <CountUp value={total} decimals={1} duration={300} /> 🪙
            </p>
            <ul className="mt-2 font-mono text-xs text-ink/80">
              <li>{say("base")} {calcSlides} × {p.perSlideBase} = {base.toFixed(1)}</li>
              {calcImages && <li>{say("images")} {calcSlides} × {p.perImageSlide} = {imageCost.toFixed(1)}</li>}
              {calcTts && <li>{say("tts")} {calcSlides} × {p.perTts} = {ttsCost.toFixed(1)}</li>}
              <li>× {mult} ({LEVEL_LABEL[calcLevel]})</li>
            </ul>
          </div>
        </StickyNote>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 2 — Payments                                                    */
/* ------------------------------------------------------------------ */

function PaymentsTab({
  draft,
  patch,
}: {
  draft: AppSettings;
  patch: (p: Partial<AppSettings>) => void;
}) {
  const url = draft.googleSheetUrl;
  const urlBad = !!url && !url.includes('docs.google.com');

  const setPack = (id: string, p: Partial<TokenPack>) =>
    patch({
      tokenPacks: draft.tokenPacks.map((pk) => (pk.id === id ? { ...pk, ...p } : pk)),
    });

  const removePack = (id: string) =>
    patch({ tokenPacks: draft.tokenPacks.filter((pk) => pk.id !== id) });

  const addPack = () => {
    const id = `pack-${Date.now().toString(36)}`;
    patch({
      tokenPacks: [...draft.tokenPacks, { id, tokens: 100, priceCents: 500, label: 'New pack' }],
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <SketchCard className="relative">
        <WashiTape rotate={2} color="blue" />
        <LabeledField
          label="Google Sheet URL"
          error={urlBad ? 'That link needs to live on docs.google.com' : undefined}
          helper="This is where the 'Open payment sheet' buttons send users. Add a row per payment; credit from the Dashboard queue."
        >
          <div className="flex flex-wrap items-center gap-2">
            <SketchInput
              value={url}
              bad={urlBad}
              onChange={(e) => patch({ googleSheetUrl: e.target.value.trim() })}
              placeholder={say("https://docs.google.com/spreadsheets/d/…")}
              className="min-w-[260px] flex-1 font-mono text-sm"
            />
            {url && !urlBad && (
              <a href={url} target="_blank" rel="noreferrer" className="no-underline">
                <SketchButton variant="secondary" size="sm">
                  
                  {say("Open")} <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                </SketchButton>
              </a>
            )}
          </div>
        </LabeledField>
      </SketchCard>

      <SketchCard>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-lg font-semibold text-ink">{say("Token packs")}</h3>
          <SketchButton variant="secondary" size="sm" onClick={addPack}>
            <Plus className="h-4 w-4" strokeWidth={2} />  {say("Add pack")}
          </SketchButton>
        </div>
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {draft.tokenPacks.map((pk, i) => (
              <motion.div
                key={pk.id}
                layout
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-wrap items-center gap-3 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2 px-3 py-2.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-yellow font-display text-base font-bold text-ink">
                  {i + 1}
                </span>
                <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                  
                  {say("Name")}
                  <input
                    value={pk.label}
                    onChange={(e) => setPack(pk.id, { label: e.target.value })}
                    className="w-32 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 font-heading font-semibold text-ink focus:border-blue focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                  
                  {say("Tokens")}
                  <input
                    type="number"
                    min={1}
                    value={pk.tokens}
                    onChange={(e) => setPack(pk.id, { tokens: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                    className="w-24 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-center font-mono font-bold text-ink focus:border-blue focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                  
                  {say("Price $")}
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={pk.priceCents / 100}
                    onChange={(e) =>
                      setPack(pk.id, { priceCents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) })
                    }
                    className="w-24 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-center font-mono font-bold text-ink focus:border-blue focus:outline-none"
                  />
                </label>
                <span className="micro text-ink-faint">
                  {formatMoney(pk.priceCents)} · ≈ {(pk.priceCents / Math.max(1, pk.tokens)).toFixed(1)}¢/🪙
                </span>
                <button
                  onClick={() => removePack(pk.id)}
                  disabled={draft.tokenPacks.length <= 1}
                  aria-label={`Remove ${pk.label}`}
                  title={draft.tokenPacks.length <= 1 ? 'Keep at least one pack' : 'Remove pack'}
                  className="ml-auto rounded-wobble-sm p-1.5 text-ink-faint hover:bg-red-soft hover:text-red disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <p className="micro mt-3 text-ink-faint">
          
          {say("Users see these as cards in Settings › Tokens. Removing a pack doesn't touch pending payments.")}
        </p>
      </SketchCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 3 — AI providers (system keys)                                  */
/* ------------------------------------------------------------------ */

/**
 * Live provider check. When a generation fails with "no AI provider produced
 * content", this says which key the server actually tried, whether it
 * answered, how long it took, and the exact error if it didn't.
 */
function ProviderHealth() {
  const check = trpc.admin.aiStatus.useMutation({
    onError: (e) => toast.error(say(e.message)),
  });
  const results = check.data?.results ?? [];

  return (
    <SketchCard className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-heading text-lg font-semibold text-ink">{say("Provider health")}</h3>
        <span className="text-xs text-ink-soft">
          
          {say("Pings every text key the server would use, in order, with a tiny real request.")}
        </span>
        <SketchButton
          variant="secondary"
          size="sm"
          className="ml-auto"
          loading={check.isPending}
          onClick={() => check.mutate()}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />  {say("Test providers")}
        </SketchButton>
      </div>

      {check.isPending && <p className="text-sm text-ink-soft">{say("Knocking on each door…")}</p>}

      {!check.isPending && check.data && results.length === 0 && (
        <p className="rounded-wobble-sm border-2 border-red bg-red-soft px-3 py-2 text-sm font-bold text-ink">
          
          {say("No text provider is configured at all — set a system key below, or add server env keys (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY…). Generation cannot work until one of them answers.")}
        </p>
      )}


      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((r, i) => (
            <li
              key={`${r.provider}-${r.source}-${i}`}
              className={`rounded-wobble-sm border-2 px-3 py-2 text-sm ${
                r.ok ? 'border-green bg-green-soft' : 'border-red bg-red-soft'
              }`}
            >
              <p className="flex flex-wrap items-center gap-2 font-heading font-semibold text-ink">
                <span>{r.ok ? '✓' : '✗'}</span>
                <span>
                  {i + 1}. {r.provider}
                  {r.model ? ` · ${r.model}` : ''}
                </span>
                <Chip kind="neutral">{r.source}</Chip>
                <span className="font-mono text-xs font-normal text-ink-soft">{r.ms}  {say("ms")}</span>
              </p>
              {r.endpoint && (
                <p className="pl-6 font-mono text-[0.7rem] text-ink-faint">{r.endpoint}</p>
              )}
              {r.error && <p className="pl-6 text-xs text-ink-soft">{r.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </SketchCard>
  );
}

function ProvidersTab({
  draft,
  patch,
}: {
  draft: AppSettings;
  patch: (p: Partial<AppSettings>) => void;
}) {
  const setKey = (cap: AiCapability, value: string) => {
    const current = draft.platformAiKeys[cap];
    patch({
      platformAiKeys: {
        ...draft.platformAiKeys,
        [cap]: { provider: current?.provider ?? 'openai', apiKey: value },
      },
    });
  };

  const setProvider = (cap: AiCapability, provider: AiProvider) => {
    const current = draft.platformAiKeys[cap];
    patch({
      platformAiKeys: {
        ...draft.platformAiKeys,
        [cap]: { provider, apiKey: current?.apiKey ?? '' },
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <StickyNote rotate={-1.5} className="max-w-xl text-[0.95rem]">
        
        {say("System keys power guests and users without BYOK keys. Users' own keys always take precedence for their generations.")}
      </StickyNote>

      <ProviderHealth />

      {CAP_META.map((cap, i) => {
        const entry = draft.platformAiKeys[cap.id];
        const masked = !!entry?.apiKey.includes('…');
        const configured = !!entry?.apiKey;
        return (
          <motion.div
            key={cap.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
          >
            <SketchCard index={i} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-lg font-semibold text-ink">{say(cap.label)}</h3>
                {configured ? (
                  <Chip kind="A1" className="border-solid">{say("active")}</Chip>
                ) : (
                  <Chip kind="neutral">{say("not set")}</Chip>
                )}
                <span className="ml-auto text-xs text-ink-faint">{cap.helper}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <LabeledField label="Provider">
                  <SketchSelect
                    value={entry?.provider ?? 'openai'}
                    onChange={(e) => setProvider(cap.id, e.target.value as AiProvider)}
                  >
                    {(cap.id === 'tts' ? [...PROVIDERS, 'elevenlabs' as AiProvider] : PROVIDERS).map(
                      (p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ),
                    )}
                  </SketchSelect>
                </LabeledField>
                <LabeledField
                  label="API key"
                  helper={
                    masked
                      ? 'Stored key shown masked — leave it untouched to keep it, or paste a new key to replace it.'
                      : 'Paste a key to enable this capability platform-wide.'
                  }
                >
                  <SketchInput
                    value={entry?.apiKey ?? ''}
                    onChange={(e) => setKey(cap.id, e.target.value)}
                    placeholder={say("Paste a key…")}
                    className="font-mono text-sm"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </LabeledField>
              </div>
            </SketchCard>
          </motion.div>
        );
      })}
      <p className="flex items-center gap-2 text-sm text-ink-soft">
        <Sparkles className="h-4 w-4 text-purple" strokeWidth={2} />
        
        {say("With no system keys, generation falls back to the built-in mock deck — the demo always works.")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 4 — Feature flags                                               */
/* ------------------------------------------------------------------ */

const FLAG_META: Record<string, { label: string; helper: string; danger?: boolean }> = {
  coachEnabled: {
    label: 'Guest Coach chat',
    helper: 'Lets guests try the Coach (3 messages) before signing in.',
  },
  guestDemo: {
    label: 'Guest demo deck',
    helper: 'Lets visitors play the public demo deck.',
  },
};

function FlagsTab({
  draft,
  patch,
}: {
  draft: AppSettings;
  patch: (p: Partial<AppSettings>) => void;
}) {
  const flags = draft.featureFlags;
  const setFlag = (key: string, value: boolean) =>
    patch({ featureFlags: { ...flags, [key]: value } });

  return (
    <SketchCard className="relative">
      <WashiTape rotate={-2} />
      <h3 className="mb-2 font-heading text-lg font-semibold text-ink">{say("Feature flags")}</h3>
      <div className="flex flex-col divide-y-2 divide-dashed divide-pencil">
        {Object.entries(flags).map(([key, value]) => {
          const meta = FLAG_META[key] ?? {
            label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
            helper: 'Custom platform flag.',
          };
          return (
            <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-heading font-semibold text-ink">{meta.label}</p>
                <p className="text-xs text-ink-faint">{meta.helper}</p>
              </div>
              <SketchToggle
                label={meta.label}
                checked={!!value}
                danger={meta.danger}
                onChange={(v) => setFlag(key, v)}
              />
            </div>
          );
        })}
      </div>
      <p className="micro mt-3 text-ink-faint">
        
        {say("Flags go live for everyone the moment you save.")}
      </p>
    </SketchCard>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function SettingsBody() {
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const settings = trpc.admin.getSettings.useQuery();
  const [draft, setDraft] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings.data && !draft) {
      setDraft(structuredClone(settings.data));
    }
  }, [settings.data, draft]);

  const tabParam = params.get('tab') as TabId | null;
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'pricing';
  const setTab = (id: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('tab', id);
      return next;
    });

  const dirty = useMemo(
    () => !!draft && !!settings.data && JSON.stringify(draft) !== JSON.stringify(settings.data),
    [draft, settings.data],
  );

  const save = trpc.admin.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(say("Settings saved ✓ — live for all users now"));
      void utils.admin.getSettings.invalidate();
      void utils.tokens.packs.invalidate();
      setDraft(null);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const patch = (p: Partial<AppSettings>) =>
    setDraft((d) => (d ? { ...d, ...p } : d));

  const sheetUrlBad = !!draft?.googleSheetUrl && !draft.googleSheetUrl.includes('docs.google.com');

  if (settings.isLoading || !draft) {
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 py-8 lg:px-8">
        <SkeletonBlock lines={4} status="Unfolding the settings page…" />
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">{say("Couldn't load platform settings.")}</p>
        <p className="mt-1 text-sm text-ink-soft">{errMsg(settings.error)}</p>
        <SketchButton className="mt-4" onClick={() => settings.refetch()}>
          
          {say("Try again")}
        </SketchButton>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-8 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">{say("Platform settings")}</h2>
        <Chip kind="admin">{say("admin")}</Chip>
      </div>

      <SketchTabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} active={activeTab} onChange={setTab} className="mb-6" />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          {activeTab === 'pricing' && <PricingTab draft={draft} patch={patch} />}
          {activeTab === 'payments' && <PaymentsTab draft={draft} patch={patch} />}
          {activeTab === 'providers' && <ProvidersTab draft={draft} patch={patch} />}
          {activeTab === 'flags' && <FlagsTab draft={draft} patch={patch} />}
        </motion.div>
      </AnimatePresence>

      {/* save bar */}
      <div className="sticky bottom-4 mt-8 flex items-center gap-3 rounded-wobble-sm border-2 border-ink bg-paper-3 px-4 py-3 shadow-offset">
        <SketchButton
          loading={save.isPending}
          disabled={!dirty || sheetUrlBad}
          onClick={() => save.mutate(draft)}
        >
          <Save className="h-4 w-4" strokeWidth={2} />  {say("Save settings")}
        </SketchButton>
        <SketchButton
          variant="ghost"
          disabled={!dirty}
          onClick={() => setDraft(settings.data ? structuredClone(settings.data) : null)}
        >
          
          {say("Discard changes")}
        </SketchButton>
        <span className="ml-auto text-xs font-bold text-ink-faint">
          {sheetUrlBad
            ? 'Fix the Google Sheet URL before saving'
            : dirty
              ? 'Unsaved changes ✏️'
              : 'Everything saved ✓'}
        </span>
      </div>
    </div>
  );
}

export default function AdminSettings() {
  return (
    <AdminGate minRole="admin">
      <SketchToaster />
      <SettingsBody />
    </AdminGate>
  );
}
