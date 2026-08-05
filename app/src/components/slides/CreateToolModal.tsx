import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  loadGenDefaults,
  saveGenDefaults,
  STYLE_PRESETS,
  SLIDE_COUNT_MIN,
  SLIDE_COUNT_MAX,
} from '@/lib/genDefaults';
import {
  LEVELS,
  LEVEL_LABEL,
  levelTier,
  repoPurpose,
  templateFilterPurpose,
  TEXT_DENSITIES,
  TEXT_DENSITY_META,
  allowedDensities,
  clampDensity,
  type ImageStyle,
  type Level,
  type RepoTemplate,
  type TextDensity,
  type LessonSeed,
} from '@contracts/types';
import {
  templatesForContext,
  TEMPLATE_FLAVORS,
  sectionForTags,
  isGradable,
  type SlideTemplate,
} from '@contracts/slide-templates';
import { Shuffle } from 'lucide-react';
import { TemplateIcon } from '@/components/repo/shared';
import TemplateBar from '@/components/templates/TemplateBar';
import { studyUrl } from '@/components/repo/shared';
import { useLessonGeneration } from '@/providers/lesson-generation';
import { TemplateBadges } from '@/components/templates/TemplatePicker';
import SketchButton from '../sketch/SketchButton';
import WashiTape from '../sketch/WashiTape';
import { getLang, say } from '@/lib/i18n';
import ContentLanguageSelect from '@/components/ContentLanguageSelect';

export interface CreateToolModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Generate INTO an existing tool instead of making a new one. A repo lesson
   * already has its study tool and its subject; the wizard is being borrowed to
   * ask how the deck should look, not to invent another tool.
   */
  toolSlug?: string;
  /** The repo lesson this deck is for — carried through to the generation. */
  seed?: LessonSeed;
  /** "configure" saves a personal customization; otherwise the repo preset. */
  intent?: 'set' | 'configure';
  /**
   * The repo's own category, which fixes what kind of deck this is. Supplied
   * with a seed so the wizard skips asking — a lesson inside a course repo is
   * a course deck, and offering "Menu item" there is a question with a wrong
   * answer.
   */
  lockedTemplate?: RepoTemplate;
  /** Prefills the prompt from the lesson's objective. */
  initialTopic?: string;
}

const CATEGORIES: { id: RepoTemplate; label: string; hint: string }[] = [
  { id: 'course', label: 'Lesson', hint: 'Teach a topic — quizzes allowed' },
  { id: 'walkthrough', label: 'Walkthrough', hint: 'Explain a topic — no quizzes' },
  { id: 'news', label: 'Time Travel News', hint: 'News from any era — no quizzes' },
  { id: 'restaurant', label: 'Menu item', hint: 'Showcase a dish — no evaluations' },
  { id: 'service', label: 'Service', hint: 'Showcase a service — no evaluations' },
  { id: 'shop', label: 'Product', hint: 'Marketplace display — no evaluations' },
];

type Step = 'topic' | 'kind' | 'look' | 'type' | 'subject' | 'focus' | 'plan' | 'text';

/**
 * Turn a generation failure into something worth reading. The server prefixes
 * these with a machine code so callers can branch on them, and the codes are
 * useful — but INSUFFICIENT_TOKENS is not a sentence, and the provider
 * diagnostics that follow a blank line belong nowhere near a toast.
 */
function readableGenError(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  const [first] = raw.split('\n\n');
  const msg = (first || 'That generation did not finish').trim();
  /* AI_UNAVAILABLE deliberately has no special case any more. It used to be
     rewritten as "every AI provider refused the request. Try again in a
     moment", which threw away the half that mattered — the server's own
     sentence names the fix, a missing key in the environment or one the author
     can add under Settings → API Keys. "Try again in a moment" is advice for a
     blip, and no amount of waiting configures an AI provider, so someone whose
     presentation never appeared retried forever and never learned why. The
     generic path below strips the code and capitalises, which is all it needed. */
  if (msg.startsWith('NEED_TICKET')) {
    return "You need a customization ticket for this repo — ask its owner. The free version is still watchable.";
  }
  // Strip the leading CODE: and capitalise, since what follows it was written
  // as a continuation ("this deck needs 16 🪙") rather than a sentence.
  const bare = msg.replace(/^[A-Z_]{4,}:\s*/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * Only a Lesson asks which field it is. A walkthrough, a news briefing, a menu
 * item, a service and a product are not STEM or humanities in any useful
 * sense, and making someone answer it — then pick a lesson flavour — is two
 * screens of nothing. Those go straight from the slides type to the plan.
 */
function stepsFor(template: RepoTemplate, lockedKind: boolean): Step[] {
  const steps: Step[] =
    template === 'course'
      ? ['topic', 'kind', 'look', 'type', 'subject', 'focus', 'plan', 'text']
      : ['topic', 'kind', 'look', 'type', 'plan', 'text'];
  // The repo already decided what kind of thing this is.
  return lockedKind ? steps.filter((s) => s !== 'kind') : steps;
}

const SUBTITLES: Record<Step, (kind: string, slides: number) => string> = {
  topic: () => 'What do you want it to be about? This is the prompt the AI works from.',
  kind: () => "Pick what it's for — the AI names and describes it from your first generation.",
  look: (kind) => `A ${kind.toLowerCase()}. How long should it be, and how should it look?`,
  type: () => 'Does it check what was learned, and how hard should it be?',
  subject: () => 'Which field is it? This decides the layouts you can choose from.',
  focus: () => 'Narrow it down, or leave it open and keep every layout.',
  plan: (_kind, slides) => `Give each of the ${slides} slides a layout — or leave some to the AI.`,
  text: () => 'How much writing should each slide carry?',
};

const SUBJECTS: { id: 'stem' | 'humanities'; label: string; hint: string; art: string }[] = [
  {
    id: 'stem',
    label: 'STEM',
    hint: 'Maths, science, medicine, code — formulas, data and worked problems',
    art: '/subject-stem.svg',
  },
  {
    id: 'humanities',
    label: 'Humanities',
    hint: 'History, literature, philosophy, language — reading and discussion',
    art: '/subject-humanities.svg',
  },
];

/**
 * Slides type. "Quiz" only means anything where the deck is allowed to carry
 * evaluations at all: generation strips quizzes from every non-education
 * purpose, so a menu or a walkthrough can only ever be a presentation. The
 * card is shown for those too, but disabled and explained, rather than
 * silently accepting a choice that would be thrown away.
 */
const SLIDE_TYPES: { id: 'quiz' | 'normal'; label: string; hint: string; art: string }[] = [
  {
    id: 'quiz',
    label: 'Quiz',
    hint: 'Teaches, then checks — slides carry questions',
    art: '/slidetype-quiz.svg',
  },
  {
    id: 'normal',
    label: 'Normal',
    hint: 'Presents the information — no questions',
    art: '/slidetype-normal.svg',
  },
];

/**
 * "New slide tool" — a short wizard on one sticky note. Step one asks what the
 * presentation is; step two sets how many slides and which image style, so the
 * choices that shape every generation are made before the tool exists rather
 * than found later on the settings page.
 *
 * The name is still not asked for: the tool starts as "Untitled …" and takes
 * its real name and description from the AI's first generated deck.
 */
export default function CreateToolModal({
  open,
  onClose,
  toolSlug,
  seed,
  intent,
  lockedTemplate,
  initialTopic,
}: CreateToolModalProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const remembered = loadGenDefaults(user?.id);

  const [step, setStep] = useState<Step>('topic');
  const [template, setTemplate] = useState<RepoTemplate>('course');
  const [slideCount, setSlideCount] = useState(remembered.slideCount);
  const [imageStyle, setImageStyle] = useState<ImageStyle>(remembered.imageStyle);
  /* What the deck will be WRITTEN in. Seeded from the language being read,
     because that is the likeliest answer, but it is a separate question — an
     admin reading in Spanish may well be building an English course. */
  const [contentLanguage, setContentLanguage] = useState<string>(getLang());
  const [includeQuiz, setIncludeQuiz] = useState(remembered.includeQuiz);
  const [level, setLevel] = useState<Level>(remembered.level);
  const [subject, setSubject] = useState<'stem' | 'humanities'>(
    remembered.subject === 'humanities' ? 'humanities' : 'stem',
  );
  /**
   * Deliberately NOT restored from the remembered settings. Slide count and
   * image style are preferences that carry between decks; "only Wolfram
   * layouts" is a decision about one lesson. Restoring it meant a lesson on
   * cannabis-infused recipes opened with a maths filter still applied from
   * whatever was built before it, and the only layouts on offer were Wolfram
   * ones. Every deck starts unfiltered.
   */
  const [flavor, setFlavor] = useState<string | null>(null);
  const [textDensity, setTextDensity] = useState<TextDensity>(remembered.textDensity);
  /**
   * One entry per slide, in running order: a layout name, or null for "let the
   * AI pick". This is the only state the plan step keeps.
   *
   * It used to be two — a per-layout tally and a separate order — which had to
   * be kept in agreement by rebuilding the order from the tally on every
   * change. That threw away any shuffle the moment a counter moved, and it
   * offered no way to say anything about ONE slide: clearing slide 3, or
   * swapping it for a different layout, is not expressible as a tally.
   */
  const [plan, setPlan] = useState<(string | null)[]>([]);
  const [instructions, setInstructions] = useState('');
  const [topic, setTopic] = useState('');

  const templatesQuery = trpc.templates.list.useQuery(undefined, { enabled: open });

  const STEPS = stepsFor(template, !!lockedTemplate);

  // A0/A1 offer the short amounts only. If the level is changed after the text
  // amount was picked — easy, since Back is right there — the selection is
  // pulled back into range rather than left showing an amount that is no
  // longer on offer and would be generated anyway.
  const densities = allowedDensities(level);
  useEffect(() => {
    setTextDensity((d) => clampDensity(level, d));
  }, [level]);

  // Only education decks keep their evaluations; everything else has them
  // stripped during generation, so offering the choice there would be a lie.
  const canQuiz = repoPurpose(template) === 'education';

  /**
   * Hold the page still while the note is open. Without this a wheel over the
   * layout list scrolls the gallery behind it instead — the list is a small
   * scroller inside a fixed overlay, and once it reaches an end (or if the
   * pointer is a pixel outside it) the browser hands the scroll to the body.
   * Freezing the body is the half of the fix that does not depend on where the
   * pointer happens to be; overscroll-contain on the list is the other half.
   */
  useEffect(() => {
    if (!open) return;
    // Both elements, deliberately. Overflow on the root propagates to the
    // viewport, and which of <html>/<body> wins depends on the other's value,
    // so locking just one is the coin-flip that let the gallery keep scrolling
    // under the note. The scroll position is restored on close, because
    // freezing a scrolled page and releasing it must not jump the view.
    const html = document.documentElement;
    const body = document.body;
    const keep = { html: html.style.overflow, body: body.style.overflow };
    const y = window.scrollY;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = keep.html;
      body.style.overflow = keep.body;
      window.scrollTo(0, y);
    };
  }, [open]);

  // Reopening starts a fresh tool, so start at the first question again — and
  // re-read the remembered settings, which the last generation may have moved.
  useEffect(() => {
    if (!open) return;
    const current = loadGenDefaults(user?.id);
    setStep('topic');
    setTemplate(lockedTemplate ?? 'course');
    setSlideCount(current.slideCount);
    setImageStyle(current.imageStyle);
    setIncludeQuiz(current.includeQuiz);
    setLevel(current.level);
    setSubject(current.subject === 'humanities' ? 'humanities' : 'stem');
    setFlavor(null);
    setTextDensity(current.textDensity);
    setPlan([]);
    setInstructions('');
    setTopic(initialTopic ?? '');
  }, [open, user?.id, lockedTemplate, initialTopic]);

  /**
   * Where the answers get spent. A standalone deck makes a new tool first; a
   * repo lesson already has one and only needs the seed and the intent carried
   * across. Either way the destination is the same page with ?generate=1, which
   * runs immediately instead of asking everything a second time.
   */
  const runOn = (slug: string) => {
    onClose();
    // studyUrl already encodes the seed, so build the rest with URLSearchParams
    // and append — hand-splicing '?' and '&' around an optional middle segment
    // is how query strings quietly come out malformed.
    const params = new URLSearchParams();
    if (intent === 'configure') params.set('intent', 'configure');
    params.set('generate', '1');
    const base = seed ? studyUrl(slug, seed) : `/slides/${slug}`;
    navigate(`${base}${base.includes('?') ? '&' : '?'}${params}`);
  };

  // The card's banner strip, drawn in the background right after creation —
  // a miss is fine (the card offers a Draw button), so failures stay quiet.
  const toolBanner = trpc.slideTools.generateBanner.useMutation({
    onSuccess: () => void utils.slideTools.list.invalidate(),
    onError: () => undefined,
  });
  const create = trpc.slideTools.create.useMutation({
    onSuccess: async ({ slug }) => {
      toolBanner.mutate({ slug, onlyIfMissing: true });
      await utils.slideTools.list.invalidate();
      runOn(slug);
    },
    onError: (err) => toast.error(say(err.message)),
  });

  /* ---- the repo-lesson path: hand the work off and get out of the way ---- */
  const lessonGen = useLessonGeneration();
  const guardedClose = () => onClose();

  /**
   * Build the lesson in the background and close immediately.
   *
   * The wizard used to own the wait — modal open, spinner turning, author pinned
   * to the page for the thirty to sixty seconds a deck takes. The job is handed
   * to a provider that lives above the router instead, so the wizard can shut
   * straight away and the lesson's own button carries the spinner. Leave the
   * repo, come back, and it is either still turning or it says Play.
   *
   * Deliberately the vanilla client, not mutation hooks: this promise outlives
   * the component that started it, and a hook does not.
   */
  const runForLesson = (paddedPlan: (string | null)[]) => {
    if (!seed) return;
    const lesson = seed;
    const client = utils.client;
    onClose();
    lessonGen.start(lesson.repoSlug, lesson.lessonSeq, async () => {
      try {
        // Resolve the tool server-side rather than trusting the slug the repo is
        // carrying. Half of the repos here have no study tool and a deleted one
        // leaves a slug pointing at nothing; both used to surface as a dead Set
        // button or "Slide tool not found" after every question was answered.
        const { slug } = await client.repos.ensureStudyTool.mutate({
          repoSlug: lesson.repoSlug,
        });
        // ONE request that generates AND saves. Two requests meant a tab closed
        // in between lost a deck the author had already been charged for; the
        // server now finishes whether or not anyone is still watching.
        await client.generate.slides.mutate({
          persist: intent === 'configure' ? 'customization' : 'preset',
          toolSlug: slug,
          seed: lesson,
          topic: topic.trim(),
          instructions: instructions.trim(),
          level,
          slideCount,
          imageStyle,
          textDensity,
          subject,
          purpose: repoPurpose(template),
          includeQuiz: wantsQuiz,
          templatePlan: paddedPlan.some(Boolean) ? paddedPlan : undefined,
        });
        toast.success(
          intent === 'configure'
            ? 'Your version is ready — press "Play yours" ✓'
            : 'Presentation set — the lesson can be played now ✓',
        );
        // A set presentation also lives as a card on the Slides page — draw
        // its banner right away so it never sits there bare. Quiet on
        // failure: the card keeps its Draw button as the fallback.
        if (intent !== 'configure') {
          void client.slideTools.generateBanner
            .mutate({ slug: `preset-${lesson.repoSlug}-l${lesson.lessonSeq}`, onlyIfMissing: true })
            .then(() => utils.slideTools.list.invalidate())
            .catch(() => undefined);
        }
      } catch (err) {
        const why = readableGenError(err);
        // The toast says it now; the row keeps saying it after the toast goes.
        lessonGen.fail(lesson.repoSlug, lesson.lessonSeq, why);
        toast.error(why, { duration: 9000 });
      } finally {
        // Refresh either way: a failure needs the button to come back.
        await utils.repos.getBySlug.invalidate({ slug: lesson.repoSlug });
        void utils.repos.courseMemory.invalidate({ slug: lesson.repoSlug });
      }
    });
  };

  const submit = () => {
    const label = CATEGORIES.find((c) => c.id === template)?.label ?? 'presentation';
    // Store the choices on the tool AND as this user's remembered defaults.
    // Both are needed: the settings page intentionally opens with the user's
    // remembered settings rather than the tool's stored ones, so saving only
    // the tool would leave this step with nothing to show for itself.
    // Pad the plan out to the slide count: a shorter plan means the remaining
    // slides are the AI's choice, which is exactly what a null entry means.
    const paddedPlan: (string | null)[] = Array.from(
      { length: slideCount },
      (_, i) => plan[i] ?? null,
    );
    saveGenDefaults(user?.id, {
      ...loadGenDefaults(user?.id),
      slideCount,
      imageStyle,
      level,
      includeQuiz: canQuiz && includeQuiz,
      textDensity,
      subject,
      flavor,
      templatePlan: paddedPlan.some(Boolean) ? paddedPlan : [],
    });
    // A repo lesson generates into the repo's own study tool, resolved (or
    // created) inside runForLesson — creating one here would leave an orphan
    // behind on every "Set".
    if (seed) {
      runForLesson(paddedPlan);
      return;
    }
    if (toolSlug) {
      runOn(toolSlug);
      return;
    }
    create.mutate({
      name: `Untitled ${label}`,
      template,
      topic: topic.trim(),
      instructions: instructions.trim(),
      defaultSlideCount: slideCount,
      defaultImageStyle: imageStyle,
      defaultLevel: level,
      contentLanguage,
    });
  };

  // Flavours whose tags actually belong to the chosen half of the catalog, so
  // "Philosophy" never shows under STEM and "Wolfram" never under humanities.
  const flavors = TEMPLATE_FLAVORS.filter((f) => {
    const section = sectionForTags(f.tags);
    return section === 'general' || section === subject;
  });

  /** True when this deck will actually carry questions. */
  const wantsQuiz = canQuiz && includeQuiz;

  const available: SlideTemplate[] = (() => {
    const all = templatesQuery.data ?? [];
    let scoped = templatesForContext(all, {
      purpose: templateFilterPurpose(repoPurpose(template)),
      stem: subject === 'stem',
      level,
    });

    // A "Normal" deck was asked for a presentation, so layouts that end in a
    // multiple choice or a worksheet do not belong on the menu. This is a hard
    // filter, not a preference: generation strips evaluations from a deck that
    // is not allowed them, so planning a slide around one produced a slide
    // whose closing step silently vanished.
    if (!wantsQuiz) scoped = scoped.filter((t) => !t.components.some(isGradable));

    if (!flavor) return scoped;
    const meta = TEMPLATE_FLAVORS.find((f) => f.id === flavor);
    if (!meta) return scoped;
    const wanted = new Set(meta.tags);
    const hit = scoped.filter((t) => t.tags.some((tag) => wanted.has(tag)));
    // The flavour is the soft one of the two: if narrowing to it leaves
    // nothing, drop the flavour rather than the no-evaluation rule.
    return hit.length > 0 ? hit : scoped;
  })();

  /** The plan, always exactly one entry per slide. */
  const slots: (string | null)[] = Array.from({ length: slideCount }, (_, i) => plan[i] ?? null);
  const counts = slots.reduce<Record<string, number>>((acc, name) => {
    if (name) acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
  const assigned = slots.filter(Boolean).length;
  const slotsLeft = slideCount - assigned;

  /** Fill the first free slide with this layout. */
  const addOne = (name: string) => {
    const next = [...slots];
    const free = next.indexOf(null);
    if (free === -1) return;
    next[free] = name;
    setPlan(next);
  };

  /** Free the LAST slide using this layout — the one most recently added. */
  const removeOne = (name: string) => {
    const next = [...slots];
    const at = next.lastIndexOf(name);
    if (at === -1) return;
    next[at] = null;
    setPlan(next);
  };

  /** Clear one specific slide, so a single slot can be changed without
   *  unpicking everything that came after it. */
  const clearSlot = (i: number) => {
    const next = [...slots];
    next[i] = null;
    setPlan(next);
  };

  const clearAll = () => setPlan([]);

  const shuffle = () => {
    // Fisher-Yates over the whole plan: every ordering equally likely, unlike
    // sort(() => Math.random() - 0.5). Empty slots move too, which is right —
    // they are positions in the deck like any other.
    const next = [...slots];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setPlan(next);
  };

  const kindLabel = CATEGORIES.find((c) => c.id === template)?.label ?? '';
  const stepIdx = STEPS.indexOf(step);
  const isLastStep = stepIdx === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            data-lenis-prevent
            className="absolute inset-0 bg-ink/30"
            onClick={guardedClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={say("New slide tool")}
            className="relative flex max-h-[92vh] w-full max-w-[480px] flex-col rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-9 shadow-offset sm:p-8 sm:pt-10"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <WashiTape rotate={-4} className="left-8" />
            <WashiTape rotate={3} color="blue" className="left-auto right-8" />

            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-4xl font-bold text-ink">{say("New slide tool")}</h2>
              <span className="micro mt-2 shrink-0 text-ink-faint">
                
                {say("Step")} {STEPS.indexOf(step) + 1}  {say("of")} {STEPS.length}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {SUBTITLES[step](kindLabel, slideCount)}
            </p>

            {/* A single sticky note: the steps swap in place. This is the only
                scroller — a tall step scrolls here rather than pushing the note
                past the viewport and handing the wheel to the page behind.

                data-lenis-prevent is the load-bearing part: the site runs Lenis
                smooth scrolling, which swallows wheel events globally and moves
                the page by script. Script-driven scrolling ignores overflow
                rules, so no amount of locking the page stops it and a nested
                scroller never sees the wheel at all — this attribute is how the
                rest of the app (chat thread, slide player, admin drawers) opts
                a container back into native scrolling. */}
            <div
              data-lenis-prevent
              className="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5"
            >
              <AnimatePresence mode="wait" initial={false}>
                {step === 'topic' ? (
                  <motion.div
                    key="topic"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18 }}
                  >
                    <label htmlFor="wizard-topic" className="micro mb-1.5 block text-ink-soft">
                      
                      {say("Topic / prompt")}
                    </label>
                    <textarea
                      id="wizard-topic"
                      autoFocus
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      rows={4}
                      maxLength={2000}
                      placeholder={say("e.g. how photosynthesis works, the fall of Constantinople, React hooks for beginners")}
                      className="w-full resize-y rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
                    />
                    <p className="mt-1.5 text-xs text-ink-faint">
                      
                      {say("A sentence is plenty — the AI writes the deck from this, and names the tool after it. When a lesson is opened from a repository, that lesson's title is used instead and this becomes the fallback.")}
                    </p>
                  </motion.div>
                ) : step === 'kind' ? (
                  <motion.div
                    key="kind"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="micro mb-1.5 block text-ink-soft">{say("What is it?")}</span>
                    <div className="grid grid-cols-2 gap-2">
                      {CATEGORIES.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setTemplate(c.id)}
                          title={say(c.hint)}
                          aria-pressed={template === c.id}
                          className={cn(
                            'flex items-center gap-2 rounded-wobble-sm border-2 px-3 py-2.5 text-left transition-all',
                            template === c.id
                              ? 'border-ink bg-yellow shadow-offset'
                              : 'border-dashed border-pencil hover:border-ink',
                          )}
                        >
                          <TemplateIcon template={c.id} className="h-4 w-4 shrink-0 text-ink" />
                          <span className="min-w-0">
                            <span className="block font-heading text-sm font-bold text-ink">
                              {say(c.label)}
                            </span>
                            <span className="micro block truncate text-[0.56rem] text-ink-faint">
                              {say(c.hint)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ) : step === 'look' ? (
                  <motion.div
                    key="look"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col gap-5"
                  >
                    <div>
                      <span className="micro mb-1.5 flex items-center justify-between text-ink-soft">
                        
                        {say("Slides")}
                        <span className="font-mono text-sm font-bold normal-case tracking-normal text-ink">
                          {slideCount}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={SLIDE_COUNT_MIN}
                        max={SLIDE_COUNT_MAX}
                        value={slideCount}
                        onChange={(e) => setSlideCount(Number(e.target.value))}
                        className="w-full accent-[#2E2820]"
                        aria-label={say("Slide count")}
                      />
                      {slideCount === SLIDE_COUNT_MAX && (
                        <p className="mt-1 font-display text-lg text-ink-soft">
                          {SLIDE_COUNT_MAX}  {say("slides max — notebooks have edges too.")}
                        </p>
                      )}
                    </div>

                    <div>
                      <span className="micro mb-1.5 block text-ink-soft">{say("Image style")}</span>
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
                              className="h-14 w-20 object-cover"
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
                            'flex h-[82px] items-center rounded-wobble-sm border-2 px-3 text-sm font-bold transition-all',
                            imageStyle === 'none'
                              ? 'border-ink bg-yellow-soft shadow-offset'
                              : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                          )}
                        >
                          
                          {say("No images")}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-ink-faint">
                        
                        {say("You can change any of this on the tool's page before generating.")}
                      </p>
                    </div>
                  </motion.div>
                ) : step === 'type' ? (
                  <motion.div
                    key="type"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col gap-5"
                  >
                    <div>
                      <span className="micro mb-1.5 block text-ink-soft">{say("Slides type")}</span>
                      <div className="grid grid-cols-2 gap-3">
                        {SLIDE_TYPES.map((t) => {
                          const chosen = (t.id === 'quiz') === includeQuiz;
                          const blocked = t.id === 'quiz' && !canQuiz;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              disabled={blocked}
                              onClick={() => setIncludeQuiz(t.id === 'quiz')}
                              aria-pressed={chosen && !blocked}
                              className={cn(
                                'overflow-hidden rounded-wobble-sm border-2 text-left transition-all',
                                blocked
                                  ? 'cursor-not-allowed border-dashed border-pencil opacity-45'
                                  : chosen
                                    ? 'border-ink shadow-offset'
                                    : 'border-pencil opacity-75 hover:opacity-100 hover:border-ink',
                              )}
                            >
                              <img
                                src={t.art}
                                alt=""
                                className="h-[76px] w-full object-cover"
                              />
                              <span className="block border-t-2 border-inherit bg-paper-3 px-2.5 py-1.5">
                                <span className="flex items-center gap-1.5">
                                  <span className="font-heading text-sm font-bold text-ink">
                                    {say(t.label)}
                                  </span>
                                  {chosen && !blocked && (
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-ink bg-yellow text-[9px] font-bold text-ink">
                                      ✓
                                    </span>
                                  )}
                                </span>
                                <span className="micro block text-[0.56rem] leading-tight text-ink-faint">
                                  {blocked ? `A ${kindLabel.toLowerCase()} never carries questions` : t.hint}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <span className="micro mb-1.5 block text-ink-soft">
                        
                        {say("Level (CEFR) — language and exercise difficulty")}
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
                      <p className="mt-2 text-xs text-ink-faint">
                        {LEVEL_LABEL[level]}  {say("— sets vocabulary and sentence complexity, and how hard the problems and worked examples get.")}
                      </p>
                    </div>

                    <div>
                      <ContentLanguageSelect
                        value={contentLanguage}
                        onChange={setContentLanguage}
                        label="What language the deck is written in"
                        className="max-w-[280px]"
                      />
                      <p className="mt-2 text-xs text-ink-faint">
                        {say(
                          'Decides the shelf as well as the words: Spanish work only shows to Spanish readers, everything else shares the English shelf.',
                        )}
                      </p>
                    </div>
                  </motion.div>
                ) : step === 'subject' ? (
                  <motion.div
                    key="subject"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="micro mb-1.5 block text-ink-soft">{say("Field")}</span>
                    <div className="grid grid-cols-2 gap-3">
                      {SUBJECTS.map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            setSubject(sub.id);
                            // The flavour list changes with the field, so a
                            // stale pick would filter against the wrong tags.
                            setFlavor(null);
                            setPlan([]);
                          }}
                          aria-pressed={subject === sub.id}
                          className={cn(
                            'overflow-hidden rounded-wobble-sm border-2 text-left transition-all',
                            subject === sub.id
                              ? 'border-ink shadow-offset'
                              : 'border-pencil opacity-75 hover:border-ink hover:opacity-100',
                          )}
                        >
                          <img src={sub.art} alt="" className="h-[76px] w-full object-cover" />
                          <span className="block border-t-2 border-inherit bg-paper-3 px-2.5 py-1.5">
                            <span className="flex items-center gap-1.5">
                              <span className="font-heading text-sm font-bold text-ink">
                                {say(sub.label)}
                              </span>
                              {subject === sub.id && (
                                <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-ink bg-yellow text-[9px] font-bold text-ink">
                                  ✓
                                </span>
                              )}
                            </span>
                            <span className="micro block text-[0.56rem] leading-tight text-ink-faint">
                              {say(sub.hint)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-ink-faint">
                      
                      {say("This decides which half of the layout catalog the next steps draw from.")}
                    </p>
                  </motion.div>
                ) : step === 'focus' ? (
                  <motion.div
                    key="focus"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="micro mb-1.5 block text-ink-soft">
                      
                      {say("Focus — narrows the layouts on offer")}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFlavor(null);
                          setPlan([]);
                        }}
                        aria-pressed={flavor === null}
                        className={cn(
                          'rounded-wobble-sm border-2 px-3 py-1.5 text-sm font-bold transition-all',
                          flavor === null
                            ? 'border-ink bg-yellow shadow-offset text-ink'
                            : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        
                        {say("Everything")}
                      </button>
                      {flavors.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          title={f.hint}
                          onClick={() => {
                            setFlavor(f.id);
                            setPlan([]);
                          }}
                          aria-pressed={flavor === f.id}
                          className={cn(
                            'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-1.5 text-sm font-bold transition-all',
                            flavor === f.id
                              ? 'border-ink bg-yellow shadow-offset text-ink'
                              : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                          )}
                        >
                          <span className="font-mono text-xs">{f.symbol}</span>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2.5 text-xs text-ink-faint">
                      {flavor
                        ? TEMPLATE_FLAVORS.find((f) => f.id === flavor)?.hint
                        : 'Every layout for this field stays on offer.'}{' '}
                      <span className="font-bold text-ink-soft">
                        {available.length}  {say("layout")}{available.length === 1 ? '' : 's'}  {say("available.")}
                      </span>
                    </p>
                  </motion.div>
                ) : step === 'plan' ? (
                  <motion.div
                    key="plan"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="micro block text-ink-soft">
                        
                        {say("Layouts —")} {assigned}  {say("of")} {slideCount}  {say("slides")}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <SketchButton
                          variant="ghost"
                          size="sm"
                          onClick={clearAll}
                          disabled={assigned === 0}
                        >
                          
                          {say("Clear all")}
                        </SketchButton>
                        <SketchButton
                          variant="ghost"
                          size="sm"
                          onClick={shuffle}
                          disabled={assigned < 2}
                        >
                          <Shuffle className="mr-1 h-3.5 w-3.5" />
                          
                          {say("Shuffle")}
                        </SketchButton>
                      </span>
                    </div>

                    {/* the running order, one chip per slide */}
                    <div className="flex flex-wrap gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil p-2">
                      {slots.map((name, i) =>
                        name ? (
                          <button
                            key={i}
                            type="button"
                            onClick={() => clearSlot(i)}
                            title={`Clear slide ${i + 1} — back to the AI's choice`}
                            aria-label={`Clear slide ${i + 1}, currently ${name}`}
                            className="group flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow-soft px-2 py-1 text-[0.62rem] font-bold text-ink transition-colors hover:bg-red-soft"
                          >
                            <span>
                              {i + 1}. {name}
                            </span>
                            <X className="h-3 w-3 shrink-0 text-ink-soft group-hover:text-red" />
                          </button>
                        ) : (
                          <span
                            key={i}
                            className="rounded-wobble-sm border-2 border-dotted border-pencil px-2 py-1 text-[0.62rem] font-bold text-ink-faint"
                          >
                            {i + 1}{say(". AI picks")}
                          </span>
                        ),
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {templatesQuery.isLoading && (
                        <p className="text-sm text-ink-faint">{say("Fetching layouts…")}</p>
                      )}
                      {available.map((t) => {
                        const n = counts[t.name] ?? 0;
                        return (
                          <div
                            key={String(t.id)}
                            className={cn(
                              'flex items-start gap-2 rounded-wobble-sm border-2 px-2.5 py-2',
                              n > 0 ? 'border-ink bg-paper-3' : 'border-dashed border-pencil',
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-heading text-sm font-bold text-ink">
                                <TemplateBadges tags={t.tags} />
                                {t.name}
                              </span>
                              {/* The layout itself, step by step — the same bar
                                  the tool page shows, so a name like "Wolfram,
                                  then answer" is not the only clue to what a
                                  slide will actually contain. */}
                              <TemplateBar components={t.components} className="mt-1" />
                            </span>
                            <button
                              type="button"
                              aria-label={`One fewer ${t.name}`}
                              onClick={() => removeOne(t.name)}
                              disabled={n === 0}
                              className="h-6 w-6 shrink-0 rounded-wobble-sm border-2 border-ink font-bold leading-none text-ink disabled:opacity-30"
                            >
                              −
                            </button>
                            <span className="w-5 shrink-0 text-center font-mono text-sm font-bold text-ink">
                              {n}
                            </span>
                            <button
                              type="button"
                              aria-label={`One more ${t.name}`}
                              onClick={() => addOne(t.name)}
                              disabled={slotsLeft === 0}
                              className="h-6 w-6 shrink-0 rounded-wobble-sm border-2 border-ink bg-yellow font-bold leading-none text-ink disabled:opacity-30"
                            >
                              +
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-ink-faint">
                      
                      {say("Showing")} {available.length}  {say("layout")}{available.length === 1 ? '' : 's'}  {say("for")}{' '}
                      {template === 'course' ? `${subject === 'stem' ? 'STEM' : 'humanities'} · ` : ''}
                      {wantsQuiz ? 'with questions' : 'no questions'}
                      {flavor ? ` · ${TEMPLATE_FLAVORS.find((f) => f.id === flavor)?.label}` : ''}.
                    </p>
                    <p className="text-xs text-ink-faint">
                      {slotsLeft > 0
                        ? `${slotsLeft} slide${slotsLeft === 1 ? '' : 's'} left for the AI to choose — or fill them yourself. Click a filled slide above to clear it.`
                        : 'Every slide has a layout. Click one above to clear it and pick a different layout, or shuffle the running order.'}
                    </p>
                  </motion.div>
                ) : step === 'text' ? (
                  <motion.div
                    key="text"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="micro mb-1.5 block text-ink-soft">
                      
                      {say("Text amount — per slide")}
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {TEXT_DENSITIES.map((d) => {
                        const meta = TEXT_DENSITY_META[d];
                        const blocked = !densities.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            disabled={blocked}
                            title={blocked ? `Too much text for ${level}` : meta.hint}
                            onClick={() => setTextDensity(d)}
                            aria-pressed={textDensity === d && !blocked}
                            className={cn(
                              'flex items-center gap-2.5 rounded-wobble-sm border-2 px-3 py-2 text-left transition-all',
                              blocked
                                ? 'cursor-not-allowed border-dashed border-pencil opacity-40'
                                : textDensity === d
                                  ? 'border-ink bg-yellow-soft shadow-offset'
                                  : 'border-dashed border-pencil hover:border-ink',
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-heading text-sm font-bold text-ink">
                                {meta.label}
                              </span>
                              <span className="micro block truncate text-[0.56rem] text-ink-faint">
                                {blocked ? `Too much reading for ${level}` : meta.hint}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[0.68rem] font-bold text-ink-soft">
                              {meta.approxChars}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {densities.length < TEXT_DENSITIES.length && (
                      <p className="mt-2 text-xs text-ink-faint">
                        {LEVEL_LABEL[level]}  {say("reads a few short sentences at a time, so only the short amounts are offered. Raise the level on the previous step for longer writing.")}
                      </p>
                    )}
                    <p className="mt-2.5 text-xs text-ink-faint">
                      
                      {say("About")}{' '}
                      <span className="font-bold text-ink-soft">
                        {(TEXT_DENSITY_META[textDensity].charsPerSlide * slideCount).toLocaleString()}{' '}
                        
                        {say("characters")}
                      </span>{' '}
                      
                      {say("across")} {slideCount}  {say("slides.")}
                    </p>
                    {TEXT_DENSITY_META[textDensity].charsPerSlide * slideCount > 26_000 && (
                      <p className="mt-1.5 rounded-wobble-sm border-2 border-dashed border-orange bg-yellow-soft px-2.5 py-1.5 text-xs text-ink">
                        
                        {say("That is a lot of writing for one request — a deck this big can run past the server's time limit. Fewer slides, or a lighter text amount, generates more reliably.")}
                      </p>
                    )}

                    <div className="mt-4">
                      <label
                        htmlFor="wizard-instructions"
                        className="micro mb-1.5 block text-ink-soft"
                      >
                        
                        {say("Anything else? — optional")}
                      </label>
                      <textarea
                        id="wizard-instructions"
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        rows={3}
                        maxLength={4000}
                        placeholder={say("e.g. focus on the Krebs cycle, use metric units, avoid analogies with sport")}
                        className="w-full resize-y rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
                      />
                      <p className="mt-1 text-xs text-ink-faint">
                        
                        {say("Steers the writing on every slide. It is saved with the tool, so a later regeneration keeps it.")}
                      </p>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              {stepIdx === 0 ? (
                <SketchButton variant="ghost" onClick={guardedClose}>
                  
                  {say("Cancel")}
                </SketchButton>
              ) : (
                <SketchButton variant="ghost" onClick={() => setStep(STEPS[stepIdx - 1])}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  
                  {say("Back")}
                </SketchButton>
              )}
              {isLastStep ? (
                <SketchButton variant="accent" loading={create.isPending} onClick={submit}>
                  {/* Keyed on the seed, not on toolSlug: the repo's tool is
                      resolved server-side now, so a lesson run has no slug to
                      recognise itself by. A repo lesson creates nothing, and
                      promising a "Create" would describe a step that does not
                      happen. */}
                  {seed ? 'Generate' : 'Create & generate'}
                </SketchButton>
              ) : (
                <SketchButton
                  variant="accent"
                  disabled={step === 'topic' && topic.trim().length < 3}
                  onClick={() => setStep(STEPS[stepIdx + 1])}
                >
                  
                  {say("Next")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </SketchButton>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
