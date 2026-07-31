import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  FileText,
  Globe,
  ImageIcon,
  NotebookPen,
  Paperclip,
  Presentation,
  ScrollText,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AuthWall from '@/components/AuthWall';
import Chip from '@/components/sketch/Chip';
import SketchButton from '@/components/sketch/SketchButton';
import StickyNote from '@/components/sketch/StickyNote';
import WashiTape from '@/components/sketch/WashiTape';
import { SquiggleDivider } from '@/components/sketch/Squiggle';
import { DoodleArrow, DoodleCheck, DoodleSparkle } from '@/components/sketch/DoodleIcons';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { loadGenDefaults, saveGenDefaults } from '@/lib/genDefaults';
import type { ImageStyle, Level, RepoTemplate } from '@contracts/types';
import { LEVELS } from '@contracts/types';
import { SketchToaster, TEMPLATE_META } from '@/components/repo/shared';
import { say } from '@/lib/i18n';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const MAX_SLIDES = 15;

const STYLE_THUMBS: { style: Exclude<ImageStyle, 'none'>; label: string; src: string }[] = [
  { style: 'sketch', label: 'Pencil sketch', src: '/style-sketch.svg' },
  { style: 'watercolor', label: 'Watercolor', src: '/style-watercolor.svg' },
  { style: 'flat', label: 'Flat vector', src: '/style-flat.svg' },
  { style: 'photo', label: 'Photo', src: '/style-photo.svg' },
];

const LANGUAGES = ['English', 'Español', 'Français', 'Deutsch', 'Português', '中文'];

const THEATER_STEPS = [
  'Drafting the syllabus…',
  'Writing lesson objectives…',
  'Linking your slide tool…',
];

/** Server-side scope proxy for the lesson-path charge (api/routers/generate.ts) */
function scopeSlidesFor(unitCount: number, lessonsPerUnit: number) {
  return Math.min(MAX_SLIDES, Math.max(3, Math.ceil((unitCount * lessonsPerUnit) / 2)));
}

type TextAttachment = { name: string; kind: 'text'; text: string };
type ImageAttachment = { name: string; kind: 'image'; mime: string; b64: string };
type Attachment = TextAttachment | ImageAttachment;

export default function LessonPath() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isGuest } = useAuth();
  const utils = trpc.useUtils();

  /* ---------------- prefills (Coach handoff: ?template=…&subject=…) -------- */
  const prefill = useMemo(() => {
    const t = searchParams.get('template');
    const template =
      t && ['course', 'restaurant', 'service', 'shop', 'walkthrough', 'news'].includes(t)
        ? (t as RepoTemplate)
        : null;
    const subject = searchParams.get('subject') ?? searchParams.get('description') ?? '';
    return { template, subject, any: !!template || !!subject };
  }, [searchParams]);

  /* ---------------- form state -------------------------------------------- */
  // Level, per-lesson slide count and image style default to what this user
  // last generated with (base: A1, 4 slides, sketch), remembered per user.
  const remembered = useMemo(() => loadGenDefaults(user?.id), [user?.id]);
  const [template, setTemplate] = useState<RepoTemplate>(prefill.template ?? 'course');
  const [subject, setSubject] = useState(prefill.subject);
  const [level, setLevel] = useState<Level>(remembered.level);
  const [audience, setAudience] = useState('');
  const [unitCount, setUnitCount] = useState(3);
  const [lessonsPerUnit, setLessonsPerUnit] = useState(3);
  const [slideCount, setSlideCount] = useState(remembered.slideCount);
  const [imageStyle, setImageStyle] = useState<ImageStyle>(remembered.imageStyle);
  const [language, setLanguage] = useState('English');
  const [instructions, setInstructions] = useState('');
  // Reference attachments the AI reads when building the repo (menu, catalog,
  // syllabus, notes). Text files → text; images are read out server-side.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  // AI banner per unit, drawn right after the notebook is created (default on).
  const [unitBanners, setUnitBanners] = useState(true);
  const [authWallOpen, setAuthWallOpen] = useState(false);
  const [theaterStep, setTheaterStep] = useState<number | null>(null);

  const onAttach = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const isImage = file.type.startsWith('image/');
      const isText = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);
      if (isImage) {
        if (file.size > 4_000_000) {
          toast.error(`${file.name} is too large (max ~4MB)`);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = String(reader.result).split(',')[1] ?? '';
          setAttachments((a) =>
            a.filter((x) => x.kind === 'image').length >= 3
              ? (toast.error(say("Up to 3 images")), a)
              : [...a, { name: file.name, kind: 'image', mime: file.type || 'image/png', b64 }],
          );
        };
        reader.readAsDataURL(file);
      } else if (isText) {
        const reader = new FileReader();
        reader.onload = () =>
          setAttachments((a) => [
            ...a,
            { name: file.name, kind: 'text', text: String(reader.result).slice(0, 20000) },
          ]);
        reader.readAsText(file);
      } else {
        toast.error(`${file.name}: upload a text or image file`);
      }
    });
  };

  const meta = TEMPLATE_META[template];
  const totalLessons = unitCount * lessonsPerUnit;
  const generating = theaterStep !== null;

  /* ---------------- live estimate (design §8.1) ---------------------------- */
  const estimate = trpc.generate.estimate.useQuery(
    {
      slideCount: scopeSlidesFor(unitCount, lessonsPerUnit),
      imageStyle,
      withTts: false,
      level,
      useOwnKey: true,
    },
    { placeholderData: (prev) => prev },
  );
  const total = estimate.data?.total ?? null;
  const balance = user?.tokenBalance ?? null;
  const insufficient = !!user && total !== null && balance !== null && balance < total;

  /* ---------------- prefetch the repos index for instant navigation ------- */
  useEffect(() => {
    void utils.repos.list.prefetch({});
  }, [utils]);

  /* ---------------- generation theater stepper ---------------------------- */
  useEffect(() => {
    if (theaterStep === null) return;
    if (theaterStep >= THEATER_STEPS.length - 1) return;
    const t = setTimeout(() => setTheaterStep((s) => (s === null ? null : s + 1)), 2600);
    return () => clearTimeout(t);
  }, [theaterStep]);

  const generate = trpc.generate.lessonPath.useMutation();
  // Fired AFTER creation rather than inside it: the notebook opens right away
  // and the banners land one by one, instead of the whole creation waiting on
  // however many images the repo has units.
  const repoBanner = trpc.repos.generateBanner.useMutation({
    onSuccess: (_r, vars) => void utils.repos.getBySlug.invalidate({ slug: vars.slug }),
    onError: () => undefined, // card banner is decoration; the unit-banner toast already reports AI trouble
  });
  const toolBanner = trpc.slideTools.generateBanner.useMutation({
    onSuccess: () => void utils.slideTools.list.invalidate(),
    onError: () => undefined,
  });
  const makeBanners = trpc.unitImages.generateBanners.useMutation({
    onSuccess: (r, vars) => {
      if (r.made > 0) {
        toast.success(`${r.made} unit banner${r.made === 1 ? '' : 's'} drawn — ${r.cost} 🪙`);
        void utils.repos.getBySlug.invalidate({ slug: vars.repoSlug });
        void utils.auth.me.invalidate();
      }
      if (r.failed > 0) toast.warning(`${r.failed} banner${r.failed === 1 ? '' : 's'} couldn't be drawn — you weren't charged for them`);
    },
    onError: (e) => toast.warning(say(`Unit banners skipped: ${e.message}`)),
  });

  const referenceFromAttachments = () => {
    const text = attachments
      .filter((a): a is TextAttachment => a.kind === 'text')
      .map((a) => `--- ${a.name} ---\n${a.text}`)
      .join('\n\n')
      .slice(0, 20000);
    const images = attachments
      .filter((a): a is ImageAttachment => a.kind === 'image')
      .slice(0, 3)
      .map((a) => ({ mime: a.mime, b64: a.b64 }));
    return {
      referenceText: text || undefined,
      referenceImages: images.length ? images : undefined,
    };
  };

  const composedDescription = () => {
    const parts = [subject.trim()];
    if (audience.trim()) parts.push(`Audience: ${audience.trim()}`);
    if (language !== 'English') parts.push(`Language: ${language}`);
    if (instructions.trim()) parts.push(`Always: ${instructions.trim()}`);
    return parts.join('\n');
  };

  const onGenerate = () => {
    if (isGuest) {
      setAuthWallOpen(true);
      return;
    }
    if (subject.trim().length < 3) {
      toast.error(say("Give your notebook a subject first ✏️"));
      return;
    }
    // Remember this user's choices so they become the defaults next time.
    saveGenDefaults(user?.id, {
      ...remembered,
      slideCount,
      level,
      imageStyle,
    });
    setTheaterStep(0);
    generate.mutate(
      {
        description: composedDescription(),
        template,
        level,
        slideCount,
        imageStyle,
        unitCount,
        lessonsPerUnit,
        webSearch,
        ...referenceFromAttachments(),
      },
      {
        onSuccess: (res) => {
          toast.success(say("Your notebook is ready!"), {
            description: `${res.ref} · ${res.cost} 🪙 spent — opening it now`,
          });
          if (res.usedMock) {
            toast.warning(say("This outline used the offline placeholder, not AI"), {
              description:
                'No AI provider answered — check the server .env key or add your own key in Settings → API Keys, then regenerate for topic-specific lessons.',
              duration: 10000,
            });
          }
          void utils.auth.me.invalidate();
          void utils.repos.list.invalidate();
          // Illustrate the fresh units in the background — the page is already
          // usable while the banners draw. The card banners (repo + tool)
          // ride along under the same switch.
          if (unitBanners) {
            makeBanners.mutate({ repoSlug: res.repoSlug });
            repoBanner.mutate({ slug: res.repoSlug, onlyIfMissing: true });
            toolBanner.mutate({ slug: res.toolSlug, onlyIfMissing: true });
          }
          navigate(`/repos/${res.repoSlug}`);
        },
        onError: (err) => {
          setTheaterStep(null);
          void utils.auth.me.invalidate();
          if (err.message.startsWith('INSUFFICIENT_TOKENS')) {
            toast.error(say("Not enough tokens for this plan"), {
              action: { label: 'Top up →', onClick: () => navigate('/settings?tab=tokens') },
            });
          } else if (err.message.startsWith('AI_UNAVAILABLE')) {
            toast.error(say("AI provider not responding — nothing was generated"), {
              description:
                'Tokens refunded. Check the server .env AI keys (e.g. GEMINI_API_KEY) or add your own key in Settings → API Keys, then try again.',
              duration: 12000,
              action: { label: 'Retry', onClick: onGenerate },
            });
          } else {
            toast.error(say(err.message || 'Generation failed — tokens refunded'), {
              action: { label: 'Retry', onClick: onGenerate },
            });
          }
        },
      },
    );
  };

  /* ---------------- render ------------------------------------------------- */
  return (
    <div className="mx-auto w-full max-w-content px-4 pb-28 pt-6 lg:px-8 lg:pb-12">
      <SketchToaster />
      <AuthWall
        open={authWallOpen}
        onClose={() => setAuthWallOpen(false)}
        message="Sign in to generate a repository + slide tool — it takes ten seconds and you get starter tokens."
      />

      {/* title + dashed route doodle */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="sr-only">{say("Lesson Path")}</h1>
        <p className="font-display text-3xl font-bold text-ink">
          
          {say("One sketch in —")}{' '}
          <span className="marker-highlight">{say("a whole notebook out")}</span>
        </p>
        <span className="flex items-center gap-1 text-2xl" aria-hidden="true">
          ✏️ <span className="mx-1 inline-block w-8 border-t-2 border-dashed border-ink-faint" /> 📒
        </span>
      </div>

      {prefill.any && (
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-purple/60 bg-purple-soft/60 px-3 py-1 text-sm text-ink"
        >
          <DoodleSparkle className="h-4 w-4 text-purple" />
          
          {say("Prefilled by Coach ✦ — tweak anything.")}
        </motion.p>
      )}

      {/* how it works — the repo ⇄ slide tool ⇄ lesson log loop */}
      <section
        aria-label={say("How it works")}
        className="mt-5 flex flex-wrap items-stretch gap-x-2 gap-y-3 rounded-wobble-3 border-2 border-dashed border-pencil bg-paper-3/70 px-4 py-4"
      >
        {[
          { icon: NotebookPen, label: 'Repository', hint: 'units → lessons → prompts' },
          { icon: Presentation, label: 'Slide tool', hint: 'each prompt becomes a deck' },
          { icon: ScrollText, label: 'Lesson log', hint: 'finished plays write back' },
        ].map((node, i) => (
          <span key={node.label} className="flex items-center gap-2">
            {i > 0 && <DoodleArrow className="hidden h-5 w-8 -scale-x-100 text-ink-faint sm:block" />}
            <span className="flex items-center gap-2 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-1.5 shadow-offset">
              <node.icon className="h-4 w-4 text-ink" strokeWidth={2} />
              <span>
                <span className="block font-heading text-sm font-semibold leading-tight text-ink">
                  {node.label}
                </span>
                <span className="block text-[0.68rem] leading-tight text-ink-faint">{node.hint}</span>
              </span>
            </span>
          </span>
        ))}
        <span className="flex items-center gap-1.5 pl-1 text-sm text-ink-soft">
          <DoodleArrow className="h-5 w-8 rotate-180 text-purple" />
          
          {say("every new deck builds on the log")}
          <DoodleSparkle className="h-4 w-4 text-purple" />
        </span>
      </section>

      {/* template picker */}
      <section aria-label={say("Use-case template")} className="mt-8">
        <SectionLabel label="What's this notebook for?" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(['course', 'walkthrough', 'news', 'restaurant', 'service', 'shop'] as RepoTemplate[]).map((t, i) => {
            const m = TEMPLATE_META[t];
            const selected = template === t;
            return (
              <motion.button
                key={t}
                type="button"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.07, ease: EASE }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setTemplate(t)}
                aria-pressed={selected}
                className={cn(
                  'relative overflow-hidden rounded-wobble-sm border-2 p-3 text-left transition-all duration-200',
                  selected
                    ? 'border-ink bg-yellow/70 shadow-offset'
                    : 'border-pencil bg-paper-3 hover:border-ink hover:shadow-offset',
                )}
              >
                {selected && <WashiTape rotate={-3} className="-top-2 left-1/2 h-5 w-16 -translate-x-1/2" />}
                <m.icon className="h-6 w-6 text-ink" strokeWidth={2} />
                <span className="mt-1.5 block font-heading font-semibold text-ink">{m.label}</span>
                <span className="mt-0.5 block text-[0.68rem] leading-tight text-ink-soft">
                  {m.caption}
                </span>
              </motion.button>
            );
          })}
        </div>
      </section>

      {/* form */}
      <div className="mt-8 max-w-[680px]">
        <div className="min-w-0">
          {generating ? (
            <Theater step={theaterStep} total={total} />
          ) : (
            <div className="flex flex-col gap-7">
              {/* subject */}
              <section>
                <SectionLabel label="Subject" />
                <label className="micro mt-3 block text-ink-soft" htmlFor="lp-subject">
                  {meta.subjectLabel}
                </label>
                <textarea
                  id="lp-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={meta.subjectPlaceholder}
                  maxLength={400}
                  rows={2}
                  className="mt-1.5 w-full resize-none rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-3 text-ink shadow-offset outline-none transition-shadow placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB]"
                />
              </section>

              {/* audience & level */}
              <section>
                <SectionLabel label="Audience & level" />
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={say("Level")}>
                  {LEVELS.map((l) => (
                    <motion.button
                      key={l}
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setLevel(l)}
                      aria-pressed={level === l}
                      className={cn(
                        'rounded-wobble-sm transition-transform',
                        level === l && 'ring-2 ring-ink ring-offset-2 ring-offset-paper',
                      )}
                    >
                      <Chip kind={l} className="cursor-pointer px-3 py-1 text-sm capitalize">
                        {l}
                      </Chip>
                    </motion.button>
                  ))}
                </div>
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder={meta.audiencePlaceholder}
                  aria-label={say("Audience")}
                  maxLength={120}
                  className="mt-3 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB]"
                />
              </section>

              {/* shape */}
              <section>
                <SectionLabel label="Shape" />
                <div className="mt-3 flex flex-col gap-4">
                  <SketchSlider
                    label={meta.unitNoun + 's'}
                    value={unitCount}
                    min={1}
                    max={8}
                    onChange={setUnitCount}
                  />
                  <SketchSlider
                    label={`${meta.lessonNoun}s per ${meta.unitNoun.toLowerCase()}`}
                    value={lessonsPerUnit}
                    min={1}
                    max={6}
                    onChange={setLessonsPerUnit}
                  />
                  <p className="font-mono text-sm text-ink-soft">
                    {totalLessons} {meta.lessonNoun.toLowerCase()}{say("s ≈")} {totalLessons}  {say("decks")}
                  </p>
                </div>
              </section>

              {/* deck style */}
              <section>
                <SectionLabel label="Deck style" />
                <div className="mt-3">
                  <SketchSlider
                    label="Slides per deck"
                    value={slideCount}
                    min={4}
                    max={MAX_SLIDES}
                    onChange={setSlideCount}
                  />
                </div>
                <p className="micro mt-4 text-ink-soft">{say("Image style")}</p>
                <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {STYLE_THUMBS.map((s) => (
                    <button
                      key={s.style}
                      type="button"
                      onClick={() => setImageStyle(s.style)}
                      aria-pressed={imageStyle === s.style}
                      className={cn(
                        'relative overflow-hidden rounded-wobble-sm border-2 bg-paper-3 transition-all',
                        imageStyle === s.style
                          ? 'border-ink shadow-offset'
                          : 'border-pencil opacity-80 hover:border-ink hover:opacity-100',
                      )}
                    >
                      <img src={s.src} alt={say(s.label)} className="aspect-[3/2] w-full object-cover" />
                      <span className="micro block px-1 py-1 text-center text-[0.58rem] text-ink">
                        {say(s.label)}
                      </span>
                      {imageStyle === s.style && (
                        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-yellow">
                          <DoodleCheck className="h-3.5 w-3.5 text-ink" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setImageStyle(imageStyle === 'none' ? 'sketch' : 'none')}
                  aria-pressed={imageStyle === 'none'}
                  className={cn(
                    'mt-2 rounded-wobble-sm border-2 px-3 py-1 text-xs font-bold transition-colors',
                    imageStyle === 'none'
                      ? 'border-ink bg-paper-2 text-ink'
                      : 'border-dashed border-pencil text-ink-faint hover:border-ink hover:text-ink',
                  )}
                >
                  
                  {say("no images — text & diagrams only (cheaper)")}
                </button>
                <label className="micro mt-4 block text-ink-soft" htmlFor="lp-lang">
                  
                  {say("Language")}
                </label>
                <select
                  id="lp-lang"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1.5 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2.5 text-sm text-ink shadow-offset outline-none focus:border-blue"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </section>

              {/* custom instructions */}
              <section>
                <SectionLabel label="Custom instructions" />
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder={say("Anything the AI should always do? e.g. 'Keep it under 5 minutes per deck', 'Always mention allergen info'")}
                  className="mt-3 w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-3 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB]"
                />
              </section>

              {/* reference attachments — AI reads these when building the repo */}
              <section>
                <SectionLabel label="Attachments" />
                <p className="mt-1 text-xs text-ink-faint">
                  
                  {say("Upload a menu, service catalog, syllabus, or notes — the AI reads them and builds the repo from their real items. Text files & images work.")}
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={webSearch}
                  onClick={() => setWebSearch((w) => !w)}
                  title={say("Look up current facts on the web before building — for real products, news, anything time-sensitive")}
                  className="mt-3 flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-sm font-bold text-ink"
                >
                  <span
                    className={cn(
                      'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                      webSearch ? 'bg-blue-soft' : 'bg-paper-2',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3 transition-all',
                        webSearch ? 'left-[18px]' : 'left-0.5',
                      )}
                    />
                  </span>
                  <Globe className="h-4 w-4" strokeWidth={2} />  {say("Search the web for current info")}
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={unitBanners}
                  onClick={() => setUnitBanners((v) => !v)}
                  title={say("Draw one AI banner per unit right after creation, so each unit is identifiable at a glance (charged per image). You can replace or redraw any of them later.")}
                  className="mt-2 flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 text-sm font-bold text-ink"
                >
                  <span
                    className={cn(
                      'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                      unitBanners ? 'bg-blue-soft' : 'bg-paper-2',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3 transition-all',
                        unitBanners ? 'left-[18px]' : 'left-0.5',
                      )}
                    />
                  </span>
                  <ImageIcon className="h-4 w-4" strokeWidth={2} />  {say("Draw a banner image for each unit")}
                </button>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-3 py-2 text-sm font-bold text-ink-soft transition-colors hover:border-ink hover:text-ink">
                    <Paperclip className="h-4 w-4" strokeWidth={2} />  {say("Add files")}
                    <input
                      type="file"
                      accept="image/*,text/*,.md,.csv,.json,.txt"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        onAttach(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {attachments.map((a, i) => (
                    <span
                      key={`${a.name}-${i}`}
                      className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-paper-2 px-2.5 py-1.5 text-xs font-semibold text-ink"
                    >
                      {a.kind === 'image' ? (
                        <ImageIcon className="h-3.5 w-3.5 text-ink-soft" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-ink-soft" />
                      )}
                      <span className="max-w-[160px] truncate">{a.name}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                        aria-label={`Remove ${a.name}`}
                        className="rounded-full p-0.5 text-ink-faint hover:bg-red-soft hover:text-red"
                      >
                        <X className="h-3 w-3" strokeWidth={2.5} />
                      </button>
                    </span>
                  ))}
                </div>
              </section>

              {/* memory — baked into the loop, always on */}
              <section className="flex items-start gap-3 rounded-wobble-sm border-2 border-dashed border-purple/50 bg-purple-soft/40 px-4 py-3">
                <span
                  role="switch"
                  aria-checked="true"
                  aria-label={say("Cross-lesson memory (always on)")}
                  className="mt-0.5 flex h-6 w-11 shrink-0 cursor-not-allowed items-center justify-end rounded-full border-2 border-ink bg-purple px-1"
                >
                  <span className="h-4 w-4 rounded-full border border-ink bg-paper-3" />
                </span>
                <p className="text-sm text-ink-soft">
                  <span className="font-heading font-semibold text-ink">
                    
                    {say("Course memory is always on ✦")}
                  </span>{' '}
                  
                  {say("— every lesson's log links forward, so each new deck builds on what earlier decks taught instead of re-teaching it.")}
                </p>
              </section>

              {/* cost + generate (desktop) */}
              <CostAndGenerate
                total={total}
                breakdown={estimate.data?.breakdown ?? []}
                usingOwnKey={estimate.data?.usingOwnKey ?? false}
                insufficient={insufficient}
                isGuest={isGuest}
                balance={balance}
                onGenerate={onGenerate}
              />
            </div>
          )}
        </div>
      </div>

      {/* mobile sticky action bar */}
      {!generating && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-paper-3 px-4 py-3 shadow-[0_-4px_0_rgba(46,40,32,.10)] lg:hidden">
          <div className="flex items-center gap-3">
            <span className="font-display text-2xl font-bold text-ink">
              ≈ {total ?? '…'} 🪙
            </span>
            {insufficient ? (
              <Link to="/settings?tab=tokens" className="flex-1 no-underline">
                <SketchButton variant="secondary" className="w-full">
                  
                  {say("Top up tokens →")}
                </SketchButton>
              </Link>
            ) : (
              <SketchButton variant="accent" className="flex-1" onClick={onGenerate}>
                
                {say("Generate repo + slide tool")}
              </SketchButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section label — wavy divider + micro label                          */
/* ------------------------------------------------------------------ */

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="micro whitespace-nowrap text-ink-soft">{label}</span>
      <SquiggleDivider className="flex-1" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slider with pencil-eraser thumb + mono readout                      */
/* ------------------------------------------------------------------ */

function SketchSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <span className="micro text-ink-soft">{label}</span>
        <span className="rounded-wobble-sm border-2 border-ink bg-paper-2 px-2 py-0.5 font-mono text-sm font-bold text-ink">
          {value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full border border-ink bg-paper-2 accent-ink
          [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-red/70
          [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-red/70"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Cost estimate sticky note + generate (design §8, lesson-path.md §4) */
/* ------------------------------------------------------------------ */

function CostAndGenerate({
  total,
  breakdown,
  usingOwnKey,
  insufficient,
  isGuest,
  balance,
  onGenerate,
}: {
  total: number | null;
  breakdown: string[];
  usingOwnKey: boolean;
  insufficient: boolean;
  isGuest: boolean;
  balance: number | null;
  onGenerate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={say("Cost estimate")} className="hidden flex-col gap-4 lg:flex">
      <StickyNote rotate={-1.5} className="max-w-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[28px] font-bold leading-none">
            ≈ {total ?? '…'} 🪙
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="micro flex items-center gap-1 text-[0.6rem] text-ink-soft hover:text-ink"
          >
            
            {say("breakdown")}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              {breakdown.map((line, i) => (
                <li key={i} className="mt-1 font-mono text-xs text-ink-soft">
                  {line}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
        {usingOwnKey && (
          <p className="mt-1.5 flex items-center gap-1 text-sm">
            <span className="line-through opacity-60">{say("text cost")}</span>  {say("Using your key — 0 🪙 for text")} <DoodleSparkle className="h-3.5 w-3.5 text-purple" />
          </p>
        )}
        <p className="mt-1.5 text-xs text-ink-soft">
          
          {say("Covers the whole plan — repo + linked slide tool. Charged only on success.")}
        </p>
      </StickyNote>

      {insufficient ? (
        <div className="flex flex-col gap-2">
          <SketchButton variant="accent" size="lg" disabled className="w-full font-display text-2xl">
            
            {say("Generate repo + slide tool")}
          </SketchButton>
          <p className="text-sm text-ink-soft">
            
            {say("You have")} {balance}  {say("🪙 — this plan needs")} {total} 🪙.{' '}
            <Link to="/settings?tab=tokens" className="font-bold text-orange hover:squiggle">
              
              {say("Top up →")}
            </Link>
          </p>
        </div>
      ) : (
        <SketchButton
          variant="accent"
          size="lg"
          onClick={onGenerate}
          className="w-full font-display text-2xl"
        >
          
          {say("Generate repo + slide tool")}
        </SketchButton>
      )}
      {isGuest && (
        <p className="text-xs text-ink-faint">
          
          {say("Guests can sketch the plan — generating asks you to sign in first.")}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Generation theater (lesson-path.md §4)                              */
/* ------------------------------------------------------------------ */

function Theater({ step, total }: { step: number; total: number | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="relative rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-9 shadow-offset"
      aria-live="polite"
    >
      <WashiTape rotate={-3} className="left-1/2 -translate-x-1/2" />
      <h2 className="flex items-center gap-2 font-display text-3xl font-bold text-ink">
        
        {say("Sketching your notebook")}
        <DoodleSparkle className="h-5 w-5 text-purple" />
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        {total !== null ? `Holding ${total} 🪙 — charged only on success.` : 'Warming up the pencils…'}
      </p>

      <ol className="mt-6 flex flex-col gap-4">
        {THEATER_STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink',
                  done ? 'bg-green-soft' : active ? 'bg-yellow' : 'bg-paper-2 opacity-60',
                )}
              >
                {done ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  >
                    <DoodleCheck className="h-4 w-4 text-green" />
                  </motion.span>
                ) : active ? (
                  <svg viewBox="0 0 20 20" className="h-4 w-4 animate-spin text-ink" fill="none" aria-hidden="true">
                    <path d="M10 2a8 8 0 1 1-7.4 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="3 4" />
                    <path d="M10 2l1.8 3.4L8.4 4z" fill="currentColor" />
                  </svg>
                ) : (
                  <span className="font-mono text-xs text-ink-faint">{i + 1}</span>
                )}
              </span>
              <span
                className={cn(
                  'font-heading text-lg',
                  done ? 'text-ink-soft line-through decoration-green' : active ? 'font-semibold text-ink' : 'text-ink-faint',
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* pencil progress squiggle */}
      <div className="mt-6 h-2 overflow-hidden rounded-full border border-ink bg-paper-2">
        <motion.div
          className="h-full bg-ink"
          initial={{ width: '8%' }}
          animate={{ width: `${12 + (step + 1) * 26}%` }}
          transition={{ duration: 0.8, ease: EASE }}
        />
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint">
        <Check className="h-3.5 w-3.5" />
        
        {say("Real AI drafting can take 10–30 seconds — hang tight while it sketches your notebook.")}
      </p>
    </motion.div>
  );
}
