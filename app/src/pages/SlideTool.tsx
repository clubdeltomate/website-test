import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Globe,
  Pencil,
  Sparkles,
  X,
  Coins,
  TriangleAlert,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import type {
  CommercialInfo,
  ImageStyle,
  LessonSeed,
  Level,
  SlideDeck,
  SlidePlanInfo,
  SlideToolSummary,
  Tone,
  WalkthroughInfo,
} from '@contracts/types';
import { LEVELS, LEVEL_LABEL, levelTier, TONES, TONE_LABEL, TONE_HINT } from '@contracts/types';
import SketchButton from '@/components/sketch/SketchButton';
import Chip from '@/components/sketch/Chip';
import StickyNote from '@/components/sketch/StickyNote';
import WashiTape from '@/components/sketch/WashiTape';
import EmptyState from '@/components/sketch/EmptyState';
import AuthWall from '@/components/AuthWall';
import { Toaster } from '@/components/ui/sonner';
import { DoodleSparkle } from '@/components/sketch/DoodleIcons';
import CreateToolModal from '@/components/slides/CreateToolModal';
import GenerationTheater from '@/components/player/GenerationTheater';
import DeckPlayer from '@/components/player/DeckPlayer';
import TemplateBar from '@/components/templates/TemplateBar';
import TemplatePicker from '@/components/templates/TemplatePicker';

import { isStemTopic } from '@contracts/stem';
import { loadGenDefaults, saveGenDefaults, type TextDensity } from '@/lib/genDefaults';
import { templatesForContext, packetsForPurpose, type LessonPacket } from '@contracts/slide-templates';
import { repoPurpose, templateFilterPurpose, type RepoTemplate } from '@contracts/types';
import { TemplateIcon } from '@/components/repo/shared';

const CATEGORY_OPTS: { id: RepoTemplate; label: string; hint: string }[] = [
  { id: 'course', label: 'Lesson', hint: 'Teach a topic — quizzes & evaluations allowed' },
  { id: 'walkthrough', label: 'Walkthrough', hint: 'Explain a topic — no quizzes, just a guided walkthrough' },
  { id: 'news', label: 'Time Travel News', hint: 'News from any era — pick a topic and a moment in time, past or future' },
  { id: 'restaurant', label: 'Menu item', hint: 'Showcase a dish — no evaluations' },
  { id: 'service', label: 'Service', hint: 'Showcase a service — no evaluations' },
  { id: 'shop', label: 'Product', hint: 'Marketplace display — no evaluations' },
];

const STYLE_PRESETS: Exclude<ImageStyle, 'none'>[] = [
  'sketch',
  'watercolor',
  'flat',
  'photo',
];

/** Time Travel News: the era timeline the period scroller moves through —
 *  chronological, capped at the Jurassic in the past and the year 3000 in the
 *  future. Scrolling left of "This week" reads history; scrolling right asks
 *  the AI to forecast that era. A custom free-text period is always available. */
const NEWS_ERAS = [
  'The Jurassic period (150 million years ago)',
  'The Stone Age',
  'The invention of the wheel (~3500 BC)',
  'Ancient Egypt (1300 BC)',
  'Classical Greece (450 BC)',
  'The Roman Empire (100 AD)',
  'The Viking Age (900 AD)',
  'The Middle Ages (1030 AD)',
  'The Renaissance (1500)',
  'The Age of Exploration (1600s)',
  'The Industrial Revolution (1850)',
  'The Wild West (1875)',
  'The Roaring Twenties (1925)',
  'The World War II years (1943)',
  'The Space Race (1965)',
  'The 1980s',
  'The 1990s',
  'The early 2000s',
  'The 2010s',
  'This week',
  'The year 2050',
  'The year 2100',
  'The year 2200',
  'The year 2500',
  'The year 3000',
] as const;
const ERA_TODAY_IDX = NEWS_ERAS.indexOf('This week');

/** News beats offered when building an "AI time news" briefing — the AI picks
 *  the actual stories, so the author only chooses the beat + the moment in time. */
const NEWS_TYPES = [
  'Top stories',
  'World',
  'Politics',
  'Business',
  'Technology & AI',
  'Science',
  'Sports',
  'Entertainment',
  'Health',
] as const;

const inputCls =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB] focus:outline-none transition-shadow';

function parseSeed(raw: string | null): LessonSeed | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(raw)) as Partial<LessonSeed>;
    if (
      typeof obj.repoSlug === 'string' &&
      typeof obj.repoRef === 'string' &&
      typeof obj.lessonTitle === 'string' &&
      typeof obj.lessonSeq === 'number' &&
      typeof obj.lessonSeqTotal === 'number'
    ) {
      return obj as LessonSeed;
    }
  } catch {
    /* malformed seed — treat as a direct run */
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Seed banner (slide-tool.md §A1)                                     */
/* ------------------------------------------------------------------ */
function SeedBanner({
  seed,
  repoTitle,
  onDismiss,
}: {
  seed: LessonSeed;
  repoTitle: string | undefined;
  onDismiss: () => void;
}) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const memoryQuery = trpc.repos.courseMemory.useQuery(
    { slug: seed.repoSlug },
    { enabled: seed.lessonSeq > 1 },
  );
  const taught = (memoryQuery.data ?? []).filter(
    (e) => e.lessonSeq < seed.lessonSeq && e.timesTaught > 0,
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.3 }}
      className="relative mb-6 overflow-visible rounded-wobble-2 border-2 border-ink bg-blue-soft p-5 pt-6 shadow-offset"
      aria-label="Lesson seed"
    >
      <WashiTape color="yellow" rotate={-3} />
      <button
        onClick={onDismiss}
        aria-label="Dismiss seed — run as Direct"
        title="Convert to a Direct run"
        className="absolute right-3 top-3 rounded-wobble-sm p-1 text-ink-soft transition-colors hover:bg-paper-3 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip kind="repo-ref">#{seed.repoRef}</Chip>
          <span className="font-heading font-semibold text-ink">
            {repoTitle ?? seed.repoSlug}
          </span>
          <span className="text-sm text-ink-soft">
            Unit: {seed.unitTitle} → Lesson: {seed.lessonTitle}
          </span>
        </div>
        <Chip kind="slide-tool" className="ml-auto">
          Lesson {seed.lessonSeq} of {seed.lessonSeqTotal}
        </Chip>
      </div>

      {seed.lessonSeq > 1 && (
        <div className="mt-3 border-t-2 border-dashed border-ink/20 pt-3">
          <button
            onClick={() => setMemoryOpen((o) => !o)}
            aria-expanded={memoryOpen}
            className="flex items-center gap-1.5 text-sm font-bold text-ink"
          >
            <DoodleSparkle className="h-4 w-4 text-purple" />
            Building on {taught.length > 0 ? taught.length : seed.lessonSeq - 1}{' '}
            completed {taught.length === 1 ? 'lesson' : 'lessons'}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', memoryOpen && 'rotate-180')}
            />
          </button>
          <AnimatePresence>
            {memoryOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0, rotate: 2 }}
                animate={{ height: 'auto', opacity: 1, rotate: 0 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <ul className="mt-2 flex flex-col gap-1.5">
                  {taught.length > 0 ? (
                    taught.map((e) => (
                      <li
                        key={e.lessonSeq}
                        className="rounded-wobble-sm border-2 border-dashed border-ink/25 bg-paper-3 px-3 py-1.5 text-xs leading-relaxed text-ink"
                      >
                        <span className="font-bold">
                          L{e.lessonSeq} taught:
                        </span>{' '}
                        {e.summaries.slice(0, 3).join(' · ') || e.lessonTitle} —
                        best quiz {e.bestScoreCorrect}/{e.bestScoreTotal}
                      </li>
                    ))
                  ) : (
                    <li className="text-xs text-ink-soft">
                      No lesson logs yet — this deck will still assume Lessons 1–
                      {seed.lessonSeq - 1} and skip re-teaching them.
                    </li>
                  )}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="micro mt-2 text-ink-soft">
            This deck will reference that material, not re-teach it.
          </p>
        </div>
      )}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Config + theater + player (slide-tool.md States A → B → C)          */
/* ------------------------------------------------------------------ */
function ToolStudio({
  tool,
  seed,
  configureIntent = false,
  onDismissSeed,
}: {
  tool: SlideToolSummary;
  seed: LessonSeed | null;
  /** arrived via a "Configure" link — generate a personal customization, never
   *  the repo preset (even for the owner/admin). */
  configureIntent?: boolean;
  onDismissSeed: () => void;
}) {
  const { user, isGuest, role } = useAuth();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [presetSaved, setPresetSaved] = useState(false);
  const setPreset = trpc.repos.setLessonPreset.useMutation();
  const saveCustom = trpc.repos.saveMyCustomization.useMutation();
  const saveToolDeck = trpc.slideTools.saveDeck.useMutation();
  const updateTool = trpc.slideTools.update.useMutation();

  // Standalone tools carry their own category (course = lesson, restaurant/
  // service/shop = commercial showcase). Editable inline; persists on change.
  const canEditTool = !isGuest && (role === 'admin' || tool.ownerName === user?.name);
  const [category, setCategory] = useState<RepoTemplate>(tool.template ?? 'course');
  const [title, setTitle] = useState(tool.name);
  const [editingTitle, setEditingTitle] = useState(false);
  const changeCategory = (c: RepoTemplate) => {
    setCategory(c);
    if (canEditTool) updateTool.mutate({ slug: tool.slug, template: c });
  };
  const commitTitle = () => {
    setEditingTitle(false);
    const next = title.trim();
    if (next.length >= 3 && next !== tool.name && canEditTool) {
      updateTool.mutate(
        { slug: tool.slug, name: next },
        { onSuccess: () => void utils.slideTools.getBySlug.invalidate({ slug: tool.slug }) },
      );
    } else if (next.length < 3) {
      setTitle(tool.name);
    }
  };

  const [descDraft, setDescDraft] = useState(tool.description ?? '');

  const [mode, setMode] = useState<'config' | 'theater' | 'player'>('config');
  const [topic, setTopic] = useState(seed?.lessonTitle || tool.topic);
  const [instructions, setInstructions] = useState(tool.instructions);
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  // Slide count, level and image style default to what THIS user last generated
  // with (base: 4 slides, A1, sketch), not the tool's stored settings — the
  // last setting a user picks becomes their new default, remembered per user.
  const remembered = useMemo(() => loadGenDefaults(user?.id), [user?.id]);
  const [level, setLevel] = useState<Level>(remembered.level);
  const [slideCount, setSlideCount] = useState(remembered.slideCount);
  const [imageStyle, setImageStyle] = useState<ImageStyle>(remembered.imageStyle);
  const [textDensity, setTextDensity] = useState<TextDensity>(remembered.textDensity);
  // News "time news" config: the AI picks the stories from the chosen beat + moment.
  const [newsType, setNewsType] = useState<string>('Top stories');
  const [newsPeriod, setNewsPeriod] = useState<string>('This week');
  // Era scroller position (Time Travel News). "Custom" swaps the slider for a
  // free-text period; the generated deck always uses `newsPeriod` either way.
  const [eraIdx, setEraIdx] = useState<number>(ERA_TODAY_IDX);
  const [customEra, setCustomEra] = useState(false);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Advanced: teaching tone / voice for the whole deck (register + jargon).
  // Seeded from the tool's saved default tone.
  const [tone, setTone] = useState<Tone>(tool.defaultTone ?? 'neutral');
  // Advanced: solve slides use the freehand scratchpad (on) or a plain answer
  // box (off) as the way to submit a worked solution.
  const [useScratchpad, setUseScratchpad] = useState(true);
  // Advanced: pinned layout template per slide (name | null = auto). Index i → slide i+1.
  const [templatePlan, setTemplatePlan] = useState<(string | null)[]>([]);
  // Apply a lesson packet: pour its templates into the NEXT OPEN (Auto) slots,
  // in order, up to the chosen slide count. Overflow beyond the slide count is
  // discarded, so stacking packets fills the deck sequentially — packet 1 fills
  // slides 1-4, packet 2 fills 5-6, etc. — and any leftover slots stay on Auto
  // for the AI to fill. The slide count is respected, never grown.
  const applyPacket = (p: LessonPacket) => {
    setTemplatePlan((prev) => {
      const plan = Array.from({ length: slideCount }, (_, i) => prev[i] ?? null);
      let ti = 0;
      for (let i = 0; i < slideCount && ti < p.templates.length; i++) {
        if (plan[i] == null) plan[i] = p.templates[ti++];
      }
      return plan;
    });
    setAdvancedOpen(true);
  };
  const [theaterDone, setTheaterDone] = useState(false);
  const [result, setResult] = useState<{
    deck: SlideDeck;
    previouslyTaught: string | null;
    usedMock: boolean;
    slidePlan: SlidePlanInfo[];
    commercial: CommercialInfo | null;
    walkthrough: WalkthroughInfo | null;
    author?: { ownerId: number | null; name: string } | null;
  } | null>(null);
  const canceledRef = useRef(false);
  // Captured when the owner presses "Generate & set preset" so the completion
  // handoff never depends on repoQuery having re-resolved by then.
  const setFlowRef = useRef(false);
  // Captured when a non-owner spends a ticket, so we save their generation as
  // their personal customization once it's ready.
  const customizeFlowRef = useRef(false);

  // repo context for seed prefill + next-lesson handoff
  const repoQuery = trpc.repos.getBySlug.useQuery(
    { slug: seed?.repoSlug ?? '' },
    { enabled: !!seed },
  );
  const allLessons = useMemo(
    () => (repoQuery.data?.units ?? []).flatMap((u) => u.lessons),
    [repoQuery.data],
  );

  // Advanced options: templates the AI may be pinned to, filtered to this
  // deck's PURPOSE (education vs commercial), subject + level.
  const templatesQuery = trpc.templates.list.useQuery();
  // Seeded from a repo → the repo's purpose. Standalone → the tool's category.
  const purpose = useMemo(
    () => repoPurpose(seed ? (repoQuery.data?.template ?? 'course') : category),
    [seed, repoQuery.data, category],
  );
  const pickableTemplates = useMemo(
    () =>
      templatesForContext(templatesQuery.data ?? [], {
        purpose: templateFilterPurpose(purpose),
        stem: isStemTopic(topic),
        level,
      }),
    [templatesQuery.data, purpose, topic, level],
  );
  // Packets match the tool's real purpose: only education packets carry
  // evaluations; news/walkthrough/commercial get display-only packet shapes.
  const packets = useMemo(() => packetsForPurpose(purpose), [purpose]);
  // Resolve a pinned template by name against the FULL catalog (not just the
  // filtered pickable set) so a packet-pinned template from another level
  // still shows its badges, sequence and bar.
  const templateByName = useMemo(
    () => new Map((templatesQuery.data ?? []).map((t) => [t.name, t])),
    [templatesQuery.data],
  );
  // pre-fill instructions with the lesson objective once the repo loads
  useEffect(() => {
    if (!seed || instructionsTouched) return;
    const lesson = allLessons.find((l) => l.globalSeq === seed.lessonSeq);
    if (lesson?.objective) setInstructions(lesson.objective);
  }, [seed, allLessons, instructionsTouched]);
  const nextLessonTitle =
    seed && seed.lessonSeq < seed.lessonSeqTotal
      ? allLessons.find((l) => l.globalSeq === seed.lessonSeq + 1)?.title ?? null
      : null;

  // TTS voices for read-aloud
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // live cost estimate (design.md §8)
  const estimateQuery = trpc.generate.estimate.useQuery({
    slideCount,
    imageStyle,
    withTts: false,
    level,
    useOwnKey: !isGuest,
  });
  const estimate = estimateQuery.data;
  const insufficient =
    !!user && !!estimate && user.tokenBalance < estimate.total;

  const generate = trpc.generate.slides.useMutation();

  // AI auto-tune: read the prompt and set level/slides/style/density plus a
  // full per-slide template plan (packets are 4 slides; longer decks get
  // every slide filled with what the AI thinks fits best).
  const tune = trpc.generate.tuneSettings.useMutation({
    onSuccess: (rec) => {
      setLevel(rec.level);
      setSlideCount(rec.slideCount);
      setImageStyle(rec.imageStyle);
      setTextDensity(rec.textDensity);
      setTemplatePlan(rec.templatePlan);
      setAdvancedOpen(true);
      toast.success(
        rec.source === 'ai'
          ? 'Settings tuned to your prompt — review them below.'
          : 'Settings preset for this category — no AI reply, used smart defaults.',
      );
    },
    onError: (err) => toast.error(err.message),
  });
  const runTune = () => {
    const t = (purpose === 'news' && !seed ? `${newsType} news` : topic).trim();
    if (t.length < 3) {
      toast.error('Write your prompt first — then I can tune the settings to it.');
      return;
    }
    tune.mutate({
      topic: t,
      purpose,
      newsPeriod: purpose === 'news' ? newsPeriod.trim() || undefined : undefined,
    });
  };

  const runGenerate = () => {
    canceledRef.current = false;
    // Remember this user's choices so they become the defaults next time.
    saveGenDefaults(user?.id, { slideCount, level, imageStyle, textDensity });
    const isSet = canPublishPreset && !!seed;
    setFlowRef.current = isSet;
    customizeFlowRef.current = !!seed && !isSet && !isGuest;
    setTheaterDone(false);
    setMode('theater');
    // "AI time news": for a standalone news briefing the beat becomes the topic
    // (the AI picks the stories) and the moment in time is passed separately.
    const newsMode = purpose === 'news' && !seed;
    generate.mutate(
      {
        toolSlug: tool.slug,
        topic: newsMode ? `${newsType} news` : topic.trim() || undefined,
        instructions: instructions.trim() || undefined,
        level,
        slideCount,
        imageStyle,
        tone,
        purpose: seed ? undefined : purpose,
        textDensity,
        newsPeriod: purpose === 'news' ? newsPeriod.trim() || undefined : undefined,
        webSearch,
        templatePlan: templatePlan.some(Boolean)
          ? templatePlan.slice(0, slideCount)
          : undefined,
        seed: seed ?? undefined,
      },
      {
        onSuccess: (res) => {
          if (canceledRef.current) return;
          setResult({
            deck: res.deck,
            previouslyTaught: res.previouslyTaught,
            usedMock: res.usedMock,
            slidePlan: res.slidePlan,
            commercial: res.commercial,
            walkthrough: res.walkthrough,
            author: res.author,
          });
          setTheaterDone(true);
          if (!isGuest) void utils.auth.me.invalidate();
          if (res.usedMock) {
            toast('Demo mode — no AI key configured, so a mock deck was sketched.', {
              icon: <Sparkles className="h-4 w-4 text-purple" />,
            });
          }
        },
        onError: (err) => {
          if (canceledRef.current) return;
          setMode('config');
          if (err.message.startsWith('AI_UNAVAILABLE')) {
            toast.error('AI provider not responding — no deck was generated', {
              description:
                'Tokens refunded. Check the server .env AI keys or add your own key in Settings → API Keys, then try again.',
              duration: 12000,
            });
          } else if (err.message.startsWith('NEED_TICKET')) {
            toast.error('You need a customization ticket for this repo', {
              description:
                "Ask the repo's owner for a ticket to generate your own version. You can still watch the free preset any time.",
              duration: 12000,
            });
          } else {
            toast.error(err.message);
          }
        },
      },
    );
  };

  const enterPlayer = () => {
    if (!result) return;
    let deck = result.deck;
    if (!includeQuiz) {
      deck = {
        ...deck,
        slides: deck.slides.map((s) => ({ ...s, quiz: undefined })),
      };
    }
    setResult({ ...result, deck });
    setMode('player');
  };

  /* ---------------- State C — player ---------------- */
  // The owner can save the deck they just generated as the item's preset, so
  // viewers watch it without regenerating. Commercial items become the sole
  // showcase; education presets become the free version (AI-graded evaluations
  // are stripped on save) alongside the paid "Customize" path.
  const isOwner = !!seed && (repoQuery.data?.ownerId === user?.id || role === 'admin');
  const canSetPreset = !!seed && isOwner;
  // A "Configure" link means "make MY own version", so even an owner's
  // generation is saved as a personal customization, never the repo preset.
  const canPublishPreset = canSetPreset && !configureIntent;
  const handleSavePreset = () => {
    if (!seed || !result) return;
    setPreset.mutate(
      { repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq, deck: result.deck },
      {
        onSuccess: () => {
          setPresetSaved(true);
          toast.success('Saved as preset — viewers can now watch it ✓');
          void utils.repos.getBySlug.invalidate({ slug: seed.repoSlug });
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  // When the owner came in via "Set", generating the deck IS the act of
  // publishing the free preset — so once it's ready we save it and go straight
  // back to the repo (the item's button flips Set → Play/Study). We never drop
  // the owner into the player. The saved deck has its AI-graded evaluations
  // stripped server-side (prepPresetDeck), so it's free for anyone to watch.
  const finishGeneration = () => {
    if (!result) return;
    if (setFlowRef.current && seed) {
      // Fire the save and go straight back to the repo — we don't wait on the
      // network so the owner always lands on the repo (the item's button flips
      // Set → Play once the save's invalidation lands). Failures surface as a
      // toast on the repo page.
      setPreset.mutate(
        { repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq, deck: result.deck },
        {
          onSuccess: () => void utils.repos.getBySlug.invalidate({ slug: seed.repoSlug }),
          onError: (e) => toast.error(`Preset didn't save: ${e.message}`),
        },
      );
      toast.success('Preset saved — now free for anyone to play ✓');
      navigate(`/repos/${seed.repoSlug}`);
      return;
    }
    // A non-owner spent a ticket → persist this as their personal customization
    // so they can replay it (free) or regenerate a new one to replace it.
    if (customizeFlowRef.current && seed && result && !result.usedMock) {
      saveCustom.mutate(
        {
          repoSlug: seed.repoSlug,
          lessonSeq: seed.lessonSeq,
          deck: result.deck,
          toolSlug: tool.slug,
        },
        { onSuccess: () => void utils.repos.getBySlug.invalidate({ slug: seed.repoSlug }) },
      );
    }
    // Standalone tool you own: save the generated deck so its card flips to
    // "Play" and this exact presentation can be replayed for free — including
    // by users with no credits — without regenerating.
    if (!seed && canEditTool && result && !result.usedMock) {
      saveToolDeck.mutate(
        { slug: tool.slug, deck: result.deck },
        {
          onSuccess: () => {
            void utils.slideTools.list.invalidate();
            void utils.slideTools.getBySlug.invalidate({ slug: tool.slug });
          },
          onError: (e) => toast.error(`Couldn't save this presentation: ${e.message}`),
        },
      );
    }
    enterPlayer();
  };

  if (mode === 'player' && result) {
    return (
      <DeckPlayer
        deck={result.deck}
        toolSlug={tool.slug}
        seed={seed}
        previouslyTaught={result.previouslyTaught}
        slidePlan={result.slidePlan}
        voiceURI={voiceURI}
        nextLessonTitle={nextLessonTitle}
        scratchpadEnabled={useScratchpad}
        commercial={result.commercial}
        walkthrough={result.walkthrough}
        author={result.author ?? null}
        onSavePreset={canPublishPreset ? handleSavePreset : undefined}
        savingPreset={setPreset.isPending}
        presetSaved={presetSaved}
        onExit={() => {
          // Finishing (or leaving) a play returns you to where the learning
          // cycle continues — the repo if this deck came from one, otherwise
          // the slide-tools drawer — never back to this config form.
          void utils.slideTools.list.invalidate();
          if (seed) navigate(`/repos/${seed.repoSlug}`);
          else navigate('/slides');
        }}
      />
    );
  }

  /* ---------------- State B — generation theater ---------------- */
  if (mode === 'theater') {
    return (
      <GenerationTheater
        slideCount={isGuest ? Math.min(slideCount, 6) : slideCount}
        topic={topic.trim() || tool.topic || tool.name}
        done={theaterDone}
        onComplete={finishGeneration}
        settingPreset={setFlowRef.current}
        onCancel={() => {
          canceledRef.current = true;
          setMode('config');
        }}
      />
    );
  }

  /* ---------------- State A — config ---------------- */
  const stem = isStemTopic(topic);
  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-8 lg:px-8">
      <Toaster position="bottom-right" />
      <AnimatePresence>{seed && (
        <SeedBanner
          seed={seed}
          repoTitle={repoQuery.data?.title}
          onDismiss={onDismissSeed}
        />
      )}</AnimatePresence>

      {/* tool header — title is editable inline for the owner */}
      <div className="flex flex-wrap items-center gap-3">
        {editingTitle ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') {
                setTitle(tool.name);
                setEditingTitle(false);
              }
            }}
            aria-label="Tool name"
            className="min-w-0 flex-1 rounded-wobble-sm border-2 border-blue bg-paper px-2 py-1 font-display text-[30px] font-bold leading-none text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => canEditTool && setEditingTitle(true)}
            title={canEditTool ? 'Click to rename' : undefined}
            className={cn(
              'group flex items-center gap-2 font-display text-[32px] font-bold leading-none text-ink',
              canEditTool && 'cursor-text',
            )}
          >
            {title}
            {canEditTool && (
              <Pencil className="h-4 w-4 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </button>
        )}
        <span className="font-mono text-sm text-ink-faint">{tool.slug}</span>
        {seed && <Chip kind="repo-ref">#{seed.repoRef}</Chip>}
      </div>
      {tool.description && (
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">{tool.description}</p>
      )}

      {/* config card */}
      <motion.div
        className="relative mt-6 rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-8 shadow-offset sm:p-8 sm:pt-9"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.07 } } }}
      >
        <WashiTape rotate={-3} />
        <WashiTape color="blue" rotate={2} className="left-auto right-8" />

        {/* optional custom name & description — collapsed by default so it
            reads as optional: left alone, the AI titles and describes the
            tool from its first generated deck. */}
        {canEditTool && (
          <motion.details
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            className="mb-5 rounded-wobble-sm border-2 border-dashed border-pencil px-3.5 py-2.5"
          >
            <summary className="micro cursor-pointer select-none text-ink-soft">
              Name &amp; description — optional · leave it and the AI writes them from your prompt
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <label className="block">
                <span className="micro mb-1 block text-ink-soft">Custom name</span>
                <input
                  className={cn(inputCls)}
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  placeholder="Leave as Untitled — the AI names it on first generation"
                />
              </label>
              <label className="block">
                <span className="micro mb-1 block text-ink-soft">Custom description</span>
                <textarea
                  className={cn(inputCls, 'min-h-[56px] resize-y')}
                  value={descDraft}
                  maxLength={2000}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={() => {
                    const next = descDraft.trim();
                    if (next !== (tool.description ?? '')) {
                      updateTool.mutate(
                        { slug: tool.slug, description: next },
                        { onSuccess: () => void utils.slideTools.getBySlug.invalidate({ slug: tool.slug }) },
                      );
                    }
                  }}
                  placeholder="Leave empty — the AI describes it from the generated deck"
                />
              </label>
            </div>
          </motion.details>
        )}

        {/* what kind of presentation — drives templates & whether evaluations
            are offered. Standalone tools only (a seeded lesson inherits the
            repo's category). */}
        {!seed && (
          <motion.div
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            className="mb-5"
          >
            <span className="micro mb-1.5 block text-ink-soft">What is this a presentation of?</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => changeCategory(c.id)}
                  title={c.hint}
                  className={cn(
                    'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-1.5 text-sm font-bold transition-all',
                    category === c.id
                      ? 'border-ink bg-yellow text-ink shadow-offset'
                      : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                  )}
                >
                  <TemplateIcon template={c.id} className="h-4 w-4" />
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              {purpose === 'commercial'
                ? 'Showcase mode — no quizzes or AI-graded evaluations; only display templates are offered.'
                : purpose === 'walkthrough'
                  ? 'Walkthrough mode — the AI explains and guides only; no quizzes, ends on a "visit author / go back" step.'
                  : purpose === 'news'
                    ? 'Time Travel News mode — pick a moment in time and the AI writes that era\'s paper: fresh headlines and stories per slide (headline, photo, report); no quizzes, ends on a "visit author / go back" step.'
                    : 'Lesson mode — evaluations and quizzes are available.'}
            </p>
          </motion.div>
        )}

        {purpose === 'news' && !seed ? (
          /* AI time news: pick a beat + moment in time, the AI picks the stories */
          <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
            <span className="micro mb-1.5 block text-ink-soft">
              News beat — the AI picks the stories
            </span>
            <div className="flex flex-wrap gap-2">
              {NEWS_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewsType(t)}
                  aria-pressed={newsType === t}
                  className={cn(
                    'rounded-wobble-sm border-2 px-3 py-1.5 text-sm font-bold transition-all',
                    newsType === t
                      ? 'border-ink bg-yellow text-ink shadow-offset'
                      : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              You don't write a prompt — pick a beat and a moment in time, and the AI briefs you on
              that.
            </p>
          </motion.div>
        ) : (
          <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
            <span className="micro mb-1 flex items-center justify-between text-ink-soft">
              <span className="flex items-center gap-2">
                Topic / prompt
                <button
                  type="button"
                  onClick={runTune}
                  disabled={tune.isPending}
                  title="Tune all settings to this prompt — the AI picks level, slides, style, text amount and a layout for every slide"
                  aria-label="Auto-tune settings from prompt"
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-yellow text-ink shadow-offset transition-transform hover:-translate-y-0.5',
                    tune.isPending && 'animate-pulse cursor-wait',
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </span>
              <span className="font-mono normal-case tracking-normal">{topic.length}/2000</span>
            </span>
            <textarea
              className={cn(inputCls, 'min-h-[84px] resize-y font-mono')}
              value={topic}
              maxLength={2000}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What should this presentation teach?"
            />
          </motion.div>
        )}

        {purpose === 'news' && (
          <motion.div
            className="mt-4"
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
          >
            <span className="micro mb-1 block text-ink-soft">
              Time period — scroll through the eras
            </span>
            {!customEra ? (
              <div className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-4 pb-3 pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="micro shrink-0 text-ink-faint">🦖 Jurassic</span>
                  <span className="truncate text-center font-heading text-base font-semibold text-ink">
                    {NEWS_ERAS[eraIdx]}
                  </span>
                  <span className="micro shrink-0 text-ink-faint">Year 3000 🚀</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={NEWS_ERAS.length - 1}
                  step={1}
                  value={eraIdx}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setEraIdx(i);
                    setNewsPeriod(NEWS_ERAS[i]);
                  }}
                  aria-label="Era in time to report from"
                  aria-valuetext={NEWS_ERAS[eraIdx]}
                  className="mt-2 w-full accent-[var(--color-ink,#2b2b2b)]"
                />
                <div className="mt-0.5 flex justify-between">
                  <span className="micro text-ink-faint">← further back in time</span>
                  <span className="micro text-ink-faint">into the future →</span>
                </div>
              </div>
            ) : (
              <input
                className={cn(inputCls)}
                value={newsPeriod}
                maxLength={200}
                onChange={(e) => setNewsPeriod(e.target.value)}
                placeholder="e.g. July 2020 · the week the Titanic sank · the year 2777"
                autoFocus
              />
            )}
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <p className="text-xs text-ink-faint">
                Past eras report the news as it stood then; future eras are the AI's forecast of
                that time. If the topic didn't exist yet, the stories adapt to what that era had.
                Turn on “Search the web” for better accuracy on recent periods.
              </p>
              <button
                type="button"
                className="shrink-0 text-xs font-bold text-blue hover:underline"
                onClick={() => {
                  if (customEra) {
                    setCustomEra(false);
                    setNewsPeriod(NEWS_ERAS[eraIdx]);
                  } else {
                    setCustomEra(true);
                  }
                }}
              >
                {customEra ? '← Back to the era scroller' : 'Type a custom period…'}
              </button>
            </div>
          </motion.div>
        )}

        <motion.div
          className="mt-4"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1 block text-ink-soft">Custom instructions</span>
          <textarea
            className={cn(inputCls, 'min-h-[64px] resize-y')}
            value={instructions}
            maxLength={4000}
            onChange={(e) => {
              setInstructions(e.target.value);
              setInstructionsTouched(true);
            }}
            placeholder="Tone, must-cover points, things to avoid…"
          />
        </motion.div>

        <motion.div
          className="mt-5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1.5 block text-ink-soft">
            Level (CEFR) — controls reading difficulty
          </span>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                aria-pressed={level === l}
                title={LEVEL_LABEL[l]}
                className={cn(
                  'rounded-wobble-sm border-2 px-3.5 py-1.5 text-sm font-bold transition-all',
                  level === l
                    ? levelTier(l) === 'light'
                      ? 'border-ink bg-green-soft text-ink shadow-offset'
                      : levelTier(l) === 'mid'
                        ? 'border-ink bg-yellow-soft text-ink shadow-offset'
                        : 'border-ink bg-red-soft text-ink shadow-offset'
                    : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div
          className="mt-5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1.5 flex items-center justify-between text-ink-soft">
            Slides
            <span className="font-mono text-sm font-bold normal-case tracking-normal text-ink">
              {slideCount}
            </span>
          </span>
          <input
            type="range"
            min={4}
            max={15}
            value={slideCount}
            onChange={(e) => setSlideCount(Number(e.target.value))}
            className="w-full accent-[#2E2820]"
            aria-label="Slide count"
          />
          {slideCount === 15 && (
            <p className="mt-1 font-display text-lg text-ink-soft">
              15 slides max — notebooks have edges too.
            </p>
          )}
          {isGuest && slideCount > 6 && (
            <p className="mt-1 text-xs font-bold text-orange">
              Guests play free — your deck will be capped at 6 slides.{' '}
              <Link to="/auth" className="squiggle">
                Sign in
              </Link>{' '}
              for up to 15.
            </p>
          )}
        </motion.div>

        <motion.div
          className="mt-5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          <span className="micro mb-1.5 block text-ink-soft">Image style</span>
          <div className="flex flex-wrap gap-2.5">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setImageStyle(s)}
                title={s}
                aria-pressed={imageStyle === s}
                className={cn(
                  'relative overflow-hidden rounded-wobble-sm border-2 transition-all duration-200 hover:-translate-y-1 hover:-rotate-1',
                  imageStyle === s
                    ? 'border-ink shadow-offset'
                    : 'border-pencil opacity-70 hover:opacity-100',
                )}
              >
                <img
                  src={`/style-${s}.svg`}
                  alt={`${s} style preset`}
                  className="h-16 w-24 object-cover"
                />
                <span className="block bg-paper-3 py-0.5 text-center font-heading text-[0.7rem] capitalize text-ink">
                  {s}
                </span>
                {imageStyle === s && (
                  <motion.span
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink bg-yellow text-[10px] font-bold text-ink"
                  >
                    ✓
                  </motion.span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setImageStyle('none')}
              aria-pressed={imageStyle === 'none'}
              className={cn(
                'flex h-[92px] items-center rounded-wobble-sm border-2 px-3 text-sm font-bold transition-all',
                imageStyle === 'none'
                  ? 'border-ink bg-yellow-soft shadow-offset'
                  : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
              )}
            >
              No images
            </button>
          </div>
        </motion.div>

        {/* options row */}
        <motion.div
          className="mt-5 flex flex-wrap items-center gap-2.5"
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
        >
          {voices.length > 0 && (
            <label className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-sm">
              <Volume2 className="h-4 w-4 text-ink-soft" />
              <select
                value={voiceURI ?? ''}
                onChange={(e) => setVoiceURI(e.target.value || null)}
                className="max-w-[180px] bg-transparent text-sm font-bold text-ink focus:outline-none"
                aria-label="Read-aloud voice"
              >
                <option value="">Default voice</option>
                {voices.slice(0, 20).map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Evaluations are a lesson-only thing — hidden in showcase and
              walkthrough (explanation-only) modes. */}
          {purpose === 'education' && (
            <button
              type="button"
              role="switch"
              aria-checked={includeQuiz}
              onClick={() => setIncludeQuiz((q) => !q)}
              className="flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-sm font-bold text-ink"
            >
              <span
                className={cn(
                  'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                  includeQuiz ? 'bg-green-soft' : 'bg-paper-2',
                )}
              >
                <motion.span
                  layout
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3"
                  animate={{ left: includeQuiz ? 18 : 2 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                />
              </span>
              Include quiz on most slides
            </button>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={webSearch}
            onClick={() => setWebSearch((w) => !w)}
            title="Look up current facts on the web before writing — great for real products, news, anything time-sensitive"
            className="flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-sm font-bold text-ink"
          >
            <span
              className={cn(
                'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                webSearch ? 'bg-blue-soft' : 'bg-paper-2',
              )}
            >
              <motion.span
                layout
                className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3"
                animate={{ left: webSearch ? 18 : 2 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              />
            </span>
            <Globe className="h-4 w-4" strokeWidth={2} /> Search the web for current info
          </button>

          {topic.trim() && (
            <Chip kind="neutral" className="border-purple bg-purple-soft">
              <DoodleSparkle className="h-3.5 w-3.5 text-purple" />
              Detected: {stem ? 'STEM — formulas on' : 'Humanities — formulas off'} ✦
            </Chip>
          )}
        </motion.div>
      </motion.div>

      {/* advanced: per-slide template plan */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="flex items-center gap-1.5 font-heading text-sm font-semibold text-ink-soft hover:text-ink"
        >
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')}
          />
          Advanced — teaching tone &amp; per-slide layout
        </button>

        <AnimatePresence initial={false}>
          {advancedOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-2/50 p-4">
                {/* Teaching tone — voice/register for the whole deck */}
                <div className="mb-4">
                  <span className="micro mb-1 block font-semibold text-ink-soft">
                    Teaching tone — the voice used to teach this subject
                  </span>
                  <p className="micro mb-2 text-ink-faint">
                    Sets how casual or technical the writing is, independent of the reading level.
                    Scholarly leans into the field's terminology; casual keeps it plain and
                    jargon-light.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTone(t)}
                        aria-pressed={tone === t}
                        title={TONE_HINT[t]}
                        className={cn(
                          'rounded-wobble-sm border-2 px-3.5 py-1.5 text-sm font-bold transition-all',
                          tone === t
                            ? 'border-ink bg-purple-soft text-ink shadow-offset'
                            : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        {TONE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                  <p className="micro mt-1.5 text-ink-faint">{TONE_HINT[tone]}</p>
                </div>

                <div className="mb-3 border-t-2 border-dashed border-pencil" />

                {/* Text amount — how much explanation each slide carries */}
                <div className="mb-4">
                  <span className="micro mb-1 block font-semibold text-ink-soft">
                    Text amount — how much explanation each slide carries
                  </span>
                  <p className="micro mb-2 text-ink-faint">
                    Same ideas, more or fewer words. Detailed builds each point out further (or
                    reinforces it from another angle); brief trims to the essentials. Every type
                    still shows a real explanation.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { id: 'minimal', label: 'Minimal', hint: 'Two sentences max per slide' },
                        { id: 'brief', label: 'Brief', hint: 'Fewer words, same idea' },
                        { id: 'standard', label: 'Standard', hint: 'A balanced amount (default)' },
                        { id: 'detailed', label: 'Detailed', hint: 'Fuller explanations, more detail' },
                      ] as { id: TextDensity; label: string; hint: string }[]
                    ).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setTextDensity(d.id)}
                        aria-pressed={textDensity === d.id}
                        title={d.hint}
                        className={cn(
                          'rounded-wobble-sm border-2 px-3.5 py-1.5 text-sm font-bold transition-all',
                          textDensity === d.id
                            ? 'border-ink bg-blue-soft text-ink shadow-offset'
                            : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-3 border-t-2 border-dashed border-pencil" />

                {/* Lesson packets — one-click recommended plans, filtered to
                    this repo's purpose (education vs menu/service/shop) */}
                <div className="mb-4">
                  <span className="micro mb-1 block font-semibold text-ink-soft">
                    {purpose === 'commercial'
                      ? 'Showcase packet — a recommended set of slides to present your item'
                      : 'Lesson packet — a recommended set of slides for an activity'}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {packets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyPacket(p)}
                        title={p.description}
                        className="rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-1.5 text-left font-heading text-sm text-ink-soft transition-colors hover:border-ink hover:bg-paper-2 hover:text-ink"
                      >
                        <span className="font-bold text-ink">{p.name}</span>
                        <span className="ml-1 text-[0.68rem] text-ink-faint">
                          · {p.templates.length} slides
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="micro mt-1.5 text-ink-faint">
                    Each packet fills the next open slides, in order, up to your slide count — stack
                    several and any extra slides are left for the AI. Overflow past your count is
                    dropped. You can still tweak any pinned slide.
                  </p>
                </div>

                <div className="mb-3 border-t-2 border-dashed border-pencil" />

                {/* Solve-slide answer mode: scratchpad vs. plain answer box */}
                <label className="mb-4 flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={useScratchpad}
                    onChange={(e) => setUseScratchpad(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#2E2820]"
                  />
                  <span className="text-sm">
                    <span className="font-heading font-semibold text-ink">
                      Annotation scratchpad on solve slides
                    </span>
                    <span className="micro block text-ink-faint">
                      On: learners work the problem out on a paginated blank scratchpad. Off: they get
                      a plain answer box instead. Either way they type a final answer that's checked.
                    </span>
                  </span>
                </label>

                <div className="mb-3 border-t-2 border-dashed border-pencil" />

                <p className="micro mb-3 text-ink-faint">
                  Pin a template so the AI drafts that slide in exactly that shape. Leave a slide on{' '}
                  <span className="font-semibold">Auto</span> to let it choose. Templates shown match
                  this deck's subject &amp; level — manage the full set on the{' '}
                  <Link to="/templates" className="squiggle font-semibold">
                    Slide templates
                  </Link>{' '}
                  page.
                </p>
                <div className="flex flex-col gap-2">
                  {Array.from({ length: slideCount }, (_, i) => {
                    const chosenName = templatePlan[i] ?? '';
                    const chosen = chosenName ? templateByName.get(chosenName) : undefined;
                    // include a pinned template that's outside this deck's
                    // filtered set (e.g. a packet slide) so it lists + displays
                    const pickerOptions =
                      chosen && !pickableTemplates.some((t) => t.name === chosen.name)
                        ? [chosen, ...pickableTemplates]
                        : pickableTemplates;
                    return (
                      <div
                        key={i}
                        className="flex flex-wrap items-start gap-2 rounded-wobble-sm border-2 border-pencil bg-paper-3 px-3 py-2"
                      >
                        <span className="micro mt-1.5 w-14 shrink-0 font-mono text-ink-faint">
                          Slide {i + 1}
                        </span>
                        <TemplatePicker
                          value={chosenName}
                          templates={pickerOptions}
                          selectedTemplate={chosen ?? null}
                          onChange={(v) =>
                            setTemplatePlan((prev) => {
                              const next = prev.slice();
                              while (next.length < slideCount) next.push(null);
                              next[i] = v;
                              return next;
                            })
                          }
                        />
                        {chosen && <TemplateBar components={chosen.components} />}
                      </div>
                    );
                  })}
                </div>
                {templatePlan.some(Boolean) && (
                  <button
                    type="button"
                    onClick={() => setTemplatePlan([])}
                    className="micro mt-3 text-ink-faint hover:text-ink"
                  >
                    Reset all to Auto
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* cost estimate + generate (slide-tool.md §A3) */}
      <div className="mt-6 grid gap-5 sm:grid-cols-[1fr_2fr]">
        <StickyNote rotate={-1.5} className="h-fit">
          <p className="flex items-center gap-1.5 font-heading text-lg font-bold">
            <Coins className="h-4 w-4 text-orange" />
            Cost estimate
          </p>
          {estimateQuery.isLoading ? (
            <p className="mt-1 animate-pulse text-sm">Counting coins…</p>
          ) : estimate ? (
            <>
              <p className="mt-1 font-mono text-2xl font-bold">
                {isGuest ? '0 🪙' : `${estimate.total} 🪙`}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-[0.8rem] leading-snug">
                {(isGuest
                  ? ['Guests play free — decks are capped at 6 slides.']
                  : estimate.breakdown
                ).map((line, i) => (
                  <li key={i}>· {line}</li>
                ))}
                {estimate.usingOwnKey && (
                  <li className="text-purple">
                    · Using your key — 0 🪙 for text ✦
                  </li>
                )}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm">Estimate unavailable.</p>
          )}
        </StickyNote>

        <div className="flex flex-col justify-end gap-2">
          {insufficient && (
            <p className="flex items-center gap-2 rounded-wobble-sm border-2 border-red bg-red-soft px-3 py-2 text-sm font-bold text-ink">
              <TriangleAlert className="h-4 w-4 shrink-0 text-red" />
              Not enough tokens for this deck.{' '}
              <Link to="/settings" className="squiggle">
                Top up
              </Link>
            </p>
          )}
          <SketchButton
            variant="accent"
            size="lg"
            className="w-full font-display text-2xl font-bold"
            disabled={insufficient || estimateQuery.isLoading}
            loading={generate.isPending}
            onClick={runGenerate}
          >
            {canPublishPreset
              ? 'Generate & set preset'
              : configureIntent && seed
                ? 'Generate my version'
                : 'Generate presentation'}
          </SketchButton>
          {canPublishPreset && (
            <p className="text-center text-xs text-ink-faint">
              Saves the free version and returns to the repo — no AI-graded activities are included,
              so anyone can play it for free.
            </p>
          )}
          {configureIntent && seed && (
            <p className="text-center text-xs text-ink-faint">
              Generates your own configured version and saves it to this lesson — play it anytime
              from the repo.
            </p>
          )}
          {isGuest && (
            <p className="text-center text-xs text-ink-faint">
              Guests generate for free (6 slides max) —{' '}
              <Link to="/auth" className="squiggle">
                sign in
              </Link>{' '}
              for full decks and saved runs.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page shell                                                          */
/* ------------------------------------------------------------------ */
export default function SlideTool() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isGuest, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [createClosed, setCreateClosed] = useState(false);

  const seed = useMemo(
    () => parseSeed(searchParams.get('seed')),
    [searchParams],
  );

  const toolQuery = trpc.slideTools.getBySlug.useQuery(
    { slug },
    { enabled: slug !== 'new', retry: false },
  );

  // /slides/new — State A unseeded: create the tool first (slides-gallery.md §1)
  if (slug === 'new') {
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 py-16">
        <Toaster position="bottom-right" />
        {!authLoading && isGuest ? (
          <>
            <EmptyState
              image="/empty-slides.svg"
              headline="Sign in to sketch a new tool"
              explainer="Slide tools live in your notebook — guests can play the existing ones."
              ctaLabel="Back to slide tools"
              onCta={() => navigate('/slides')}
            />
            <AuthWall open onClose={() => navigate('/slides')} />
          </>
        ) : (
          <>
            <EmptyState
              image="/empty-slides.svg"
              headline="Let's sketch a new slide tool"
              explainer="Fill in the card — you'll land on its config page next."
            />
            <CreateToolModal
              open={!createClosed}
              onClose={() => {
                setCreateClosed(true);
                navigate('/slides');
              }}
            />
          </>
        )}
      </div>
    );
  }

  const dismissSeed = () => {
    setSearchParams({}, { replace: true });
  };

  if (toolQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 py-10 lg:px-8">
        <div className="flex flex-col gap-4">
          <div className="skeleton-stroke h-9 w-2/5" />
          <div className="skeleton-stroke h-4 w-3/5" />
          <div className="skeleton-stroke mt-4 h-64 w-full rounded-wobble-2" />
          <p className="text-center font-display text-2xl text-ink-faint">
            Sharpening pencils…
          </p>
        </div>
      </div>
    );
  }

  if (toolQuery.isError || !toolQuery.data) {
    return (
      <EmptyState
        image="/empty-slides.svg"
        headline="Couldn't find that slide tool"
        explainer="It may have been deleted, or the link is smudged."
        ctaLabel="Back to slide tools"
        onCta={() => navigate('/slides')}
      />
    );
  }

  return (
    <ToolStudio
      key={`${toolQuery.data.slug}-${seed ? 'seeded' : 'direct'}`}
      tool={toolQuery.data}
      seed={seed}
      configureIntent={searchParams.get('intent') === 'configure'}
      onDismissSeed={dismissSeed}
    />
  );
}
