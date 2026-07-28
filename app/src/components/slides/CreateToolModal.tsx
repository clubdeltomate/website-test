import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight } from 'lucide-react';
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
  type ImageStyle,
  type Level,
  type RepoTemplate,
} from '@contracts/types';
import { TemplateIcon } from '@/components/repo/shared';
import SketchButton from '../sketch/SketchButton';
import WashiTape from '../sketch/WashiTape';

export interface CreateToolModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES: { id: RepoTemplate; label: string; hint: string }[] = [
  { id: 'course', label: 'Lesson', hint: 'Teach a topic — quizzes allowed' },
  { id: 'walkthrough', label: 'Walkthrough', hint: 'Explain a topic — no quizzes' },
  { id: 'news', label: 'Time Travel News', hint: 'News from any era — no quizzes' },
  { id: 'restaurant', label: 'Menu item', hint: 'Showcase a dish — no evaluations' },
  { id: 'service', label: 'Service', hint: 'Showcase a service — no evaluations' },
  { id: 'shop', label: 'Product', hint: 'Marketplace display — no evaluations' },
];

type Step = 'kind' | 'look' | 'type';
const STEPS: Step[] = ['kind', 'look', 'type'];

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
export default function CreateToolModal({ open, onClose }: CreateToolModalProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const remembered = loadGenDefaults(user?.id);

  const [step, setStep] = useState<Step>('kind');
  const [template, setTemplate] = useState<RepoTemplate>('course');
  const [slideCount, setSlideCount] = useState(remembered.slideCount);
  const [imageStyle, setImageStyle] = useState<ImageStyle>(remembered.imageStyle);
  const [includeQuiz, setIncludeQuiz] = useState(remembered.includeQuiz);
  const [level, setLevel] = useState<Level>(remembered.level);

  // Only education decks keep their evaluations; everything else has them
  // stripped during generation, so offering the choice there would be a lie.
  const canQuiz = repoPurpose(template) === 'education';

  // Reopening starts a fresh tool, so start at the first question again — and
  // re-read the remembered settings, which the last generation may have moved.
  useEffect(() => {
    if (!open) return;
    const current = loadGenDefaults(user?.id);
    setStep('kind');
    setTemplate('course');
    setSlideCount(current.slideCount);
    setImageStyle(current.imageStyle);
    setIncludeQuiz(current.includeQuiz);
    setLevel(current.level);
  }, [open, user?.id]);

  const create = trpc.slideTools.create.useMutation({
    onSuccess: async ({ slug }) => {
      await utils.slideTools.list.invalidate();
      onClose();
      navigate(`/slides/${slug}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const label = CATEGORIES.find((c) => c.id === template)?.label ?? 'presentation';
    // Store the choices on the tool AND as this user's remembered defaults.
    // Both are needed: the settings page intentionally opens with the user's
    // remembered settings rather than the tool's stored ones, so saving only
    // the tool would leave this step with nothing to show for itself.
    saveGenDefaults(user?.id, {
      ...loadGenDefaults(user?.id),
      slideCount,
      imageStyle,
      level,
      includeQuiz: canQuiz && includeQuiz,
    });
    create.mutate({
      name: `Untitled ${label}`,
      template,
      defaultSlideCount: slideCount,
      defaultImageStyle: imageStyle,
      defaultLevel: level,
    });
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
          <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="New slide tool"
            className="relative w-full max-w-[480px] rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-9 shadow-offset sm:p-8 sm:pt-10"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <WashiTape rotate={-4} className="left-8" />
            <WashiTape rotate={3} color="blue" className="left-auto right-8" />

            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-4xl font-bold text-ink">New slide tool</h2>
              <span className="micro mt-2 shrink-0 text-ink-faint">
                Step {STEPS.indexOf(step) + 1} of {STEPS.length}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {step === 'kind'
                ? "Pick what it's for — the AI names and describes it from your first generation."
                : step === 'look'
                  ? `A ${kindLabel.toLowerCase()}. How long should it be, and how should it look?`
                  : 'Does it check what was learned, and how hard should it be?'}
            </p>

            {/* A single sticky note: the steps swap in place. */}
            <div className="mt-5">
              <AnimatePresence mode="wait" initial={false}>
                {step === 'kind' ? (
                  <motion.div
                    key="kind"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="micro mb-1.5 block text-ink-soft">What is it?</span>
                    <div className="grid grid-cols-2 gap-2">
                      {CATEGORIES.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setTemplate(c.id)}
                          title={c.hint}
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
                              {c.label}
                            </span>
                            <span className="micro block truncate text-[0.56rem] text-ink-faint">
                              {c.hint}
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
                        Slides
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
                        aria-label="Slide count"
                      />
                      {slideCount === SLIDE_COUNT_MAX && (
                        <p className="mt-1 font-display text-lg text-ink-soft">
                          {SLIDE_COUNT_MAX} slides max — notebooks have edges too.
                        </p>
                      )}
                    </div>

                    <div>
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
                          No images
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-ink-faint">
                        You can change any of this on the tool's page before generating.
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="type"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col gap-5"
                  >
                    <div>
                      <span className="micro mb-1.5 block text-ink-soft">Slides type</span>
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
                                    {t.label}
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
                        Level (CEFR) — language and exercise difficulty
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
                        {LEVEL_LABEL[level]} — sets vocabulary and sentence complexity, and how hard
                        the problems and worked examples get.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              {stepIdx === 0 ? (
                <SketchButton variant="ghost" onClick={onClose}>
                  Cancel
                </SketchButton>
              ) : (
                <SketchButton variant="ghost" onClick={() => setStep(STEPS[stepIdx - 1])}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back
                </SketchButton>
              )}
              {isLastStep ? (
                <SketchButton variant="accent" loading={create.isPending} onClick={submit}>
                  Create &amp; open
                </SketchButton>
              ) : (
                <SketchButton variant="accent" onClick={() => setStep(STEPS[stepIdx + 1])}>
                  Next
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
