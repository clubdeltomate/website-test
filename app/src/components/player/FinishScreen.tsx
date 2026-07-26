import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { ArrowRight, PlayCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { isPassingScore, PASS_THRESHOLD } from '@contracts/progress';
import type { LessonSeed, SlideDeck, DeckAnnotations } from '@contracts/types';
import SketchButton from '../sketch/SketchButton';
import Chip from '../sketch/Chip';
import { DoodleCheck } from '../sketch/DoodleIcons';
import type { QuizAnswer } from './QuizCard';

export interface FinishScreenProps {
  deck: SlideDeck;
  toolSlug: string;
  seed: LessonSeed | null;
  answers: Record<number, QuizAnswer>;
  /** freehand marks the player left on the slides, saved with the run */
  annotations?: DeckAnnotations;
  elapsedSec: number;
  nextLessonTitle: string | null;
  onReplay: () => void;
  onExitToConfig: () => void;
  onReviewSlide: (idx: number) => void;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Score count-up (design.md §6: 800ms ease-out) */
function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/**
 * Finish screen (slide-tool.md §C6) — the ONLY moment a run is saved:
 * runs.complete fires once on mount with the full play record.
 */
export default function FinishScreen({
  deck,
  toolSlug,
  seed,
  answers,
  annotations,
  elapsedSec,
  nextLessonTitle,
  onReplay,
  onExitToConfig,
  onReviewSlide,
}: FinishScreenProps) {
  const reduced = useReducedMotion();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const firedRef = useRef(false);

  const answered = Object.values(answers);
  const scoreTotal = answered.length;
  const scoreCorrect = answered.filter((a) => a.firstCorrect).length;
  const displayScore = useCountUp(scoreCorrect);
  const passed = isPassingScore(scoreCorrect, scoreTotal);

  const complete = trpc.runs.complete.useMutation({
    onSuccess: () => {
      // refresh the repo page so the lesson chip (completed / try again)
      // and next-up marker reflect this run when the player goes back
      if (seed) {
        void utils.repos.getBySlug.invalidate({ slug: seed.repoSlug });
        void utils.repos.lessonRuns.invalidate({ slug: seed.repoSlug, limit: 100 });
        void utils.repos.courseMemory.invalidate({ slug: seed.repoSlug });
        void utils.repos.list.invalidate();
      } else {
        // standalone tool — refresh the drawer so its card leaves the "draft"
        // (green "Generate") state and shows the yellow "Play" now a run exists
        void utils.slideTools.list.invalidate();
      }
    },
  });

  const save = () => {
    const perSlide = deck.slides.map((slide, i) => {
      const prose = slide.components.find((c) => c.type === 'prose');
      const summary =
        prose && prose.type === 'prose'
          ? (prose.paragraphs[0] ?? slide.title).slice(0, 220)
          : slide.title;
      const visuals = slide.components
        .map((c) => c.type)
        .filter((t) => t !== 'prose' && t !== 'stickynote');
      const ans = answers[i];
      // the student's recorded response: option text (mcq/mcq2) or typed text
      const chosenOption =
        slide.quiz && ans
          ? ans.firstText ??
            (typeof ans.firstChosen === 'number'
              ? slide.quiz.options?.[ans.firstChosen] ?? null
              : null)
          : null;
      return {
        title: slide.title,
        summary,
        visuals,
        question: slide.quiz?.question ?? null,
        chosenOption,
        correct: slide.quiz && ans ? ans.firstCorrect : null,
      };
    });
    // only send annotations if the player actually drew something — on a slide
    // overlay OR on a solve worksheet scratchpad
    const hasMarks =
      !!annotations &&
      (Object.values(annotations.slides).some((list) => list.length > 0) ||
        Object.values(annotations.scratch ?? {}).some((pages) =>
          pages.some((page) => page.length > 0),
        ));
    complete.mutate({
      toolSlug,
      seed: seed ?? undefined,
      level: deck.level,
      imageStyle: deck.imageStyle,
      slideCount: deck.slides.length,
      elapsedSec,
      playerName: user?.name,
      deck,
      perSlide,
      annotations: hasMarks ? annotations : undefined,
    });
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // the ONLY moment a run is saved (slide-tool.md §C6) — once, on mount
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    saveRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // paper-bit confetti burst (slide-tool.md §C6)
  useEffect(() => {
    if (reduced) return;
    const colors = ['#FFC53D', '#3F74D6', '#4C9A5C', '#2E2820', '#FFE9AE'];
    confetti({
      particleCount: 140,
      spread: 80,
      origin: { y: 0.35 },
      colors,
      scalar: 0.9,
      ticks: 180,
    });
    const t = window.setTimeout(
      () =>
        confetti({
          particleCount: 60,
          angle: 60,
          spread: 60,
          origin: { x: 0, y: 0.6 },
          colors,
        }),
      250,
    );
    const t2 = window.setTimeout(
      () =>
        confetti({
          particleCount: 60,
          angle: 120,
          spread: 60,
          origin: { x: 1, y: 0.6 },
          colors,
        }),
      400,
    );
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [reduced]);

  const verdict =
    scoreTotal === 0
      ? 'Deck complete — no quizzes this time.'
      : scoreCorrect === scoreTotal
        ? "Chef's kiss!"
        : passed
          ? "Solid — one review and it's yours."
          : 'Worth a replay — the notebook is patient.';
  const avgPerSlide =
    deck.slides.length > 0 ? Math.round(elapsedSec / deck.slides.length) : 0;
  const hasNextLesson = seed && seed.lessonSeq < seed.lessonSeqTotal;

  const retrySave = () => {
    complete.reset();
    save();
  };

  return (
    <div className="mx-auto max-w-[860px] px-4 py-10">
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="flex flex-col items-center text-center"
      >
        <img
          src="/finish-celebration.svg"
          alt="Trophy doodle with confetti"
          className="w-64 max-w-full"
        />
        <h1 className="mt-4 font-display text-6xl font-bold leading-none text-ink sm:text-7xl">
          {scoreTotal > 0 ? (
            <>
              {displayScore}{' '}
              <span className="text-ink-faint">/ {scoreTotal}</span>
            </>
          ) : (
            'Done!'
          )}
        </h1>
        <p className="mt-2 font-display text-3xl text-ink-soft">{verdict}</p>
        {seed && scoreTotal > 0 && (
          <span
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-1 font-heading text-sm font-bold shadow-offset',
              passed ? 'border-green bg-green-soft text-green' : 'border-red bg-red-soft text-red',
            )}
          >
            {passed ? (
              <>
                <DoodleCheck className="h-4 w-4" /> Lesson completed
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" /> Below {Math.round(PASS_THRESHOLD * 100)}% — marked
                try again
              </>
            )}
          </span>
        )}
      </motion.div>

      {/* save status — never lose the log silently (§C6) */}
      {complete.isPending && (
        <p className="mt-6 text-center font-display text-2xl text-ink-faint">
          Grading your quiz…
        </p>
      )}
      {complete.isError && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 rounded-wobble-sm border-2 border-red bg-red-soft px-4 py-3 text-sm font-bold text-ink">
          <TriangleAlert className="h-4 w-4 text-red" />
          Couldn't save this run — your log matters to us.
          <SketchButton size="sm" variant="secondary" onClick={retrySave}>
            Retry save
          </SketchButton>
        </div>
      )}
      {complete.isSuccess && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-center text-sm text-ink-soft">
            Run saved ✦{' '}
            {seed
              ? 'The lesson log was folded into this repo’s memory.'
              : 'Find it under Presentation runs.'}
          </p>
          {complete.data?.runId && (
            <Link to={`/runs/${complete.data.runId}/replay`} className="no-underline">
              <SketchButton size="sm" variant="secondary">
                <PlayCircle className="h-4 w-4" />
                Review this play
              </SketchButton>
            </Link>
          )}
        </div>
      )}

      {/* stats row */}
      <div className="mt-8 grid grid-cols-3 gap-3">
        {[
          { label: 'Elapsed', value: fmtTime(elapsedSec) },
          { label: 'Per slide', value: `${avgPerSlide}s` },
          {
            label: 'First-try accuracy',
            value:
              scoreTotal > 0
                ? `${Math.round((scoreCorrect / scoreTotal) * 100)}%`
                : '—',
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-wobble-2 border-2 border-ink bg-paper-3 p-4 text-center shadow-offset"
          >
            <p className="font-mono text-xl font-bold text-ink">{s.value}</p>
            <p className="micro mt-1 text-ink-faint">{s.label}</p>
          </div>
        ))}
      </div>

      {/* review list */}
      {scoreTotal > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-3xl font-bold text-ink">
            Review your answers
          </h2>
          <ul className="mt-4 flex flex-col gap-2.5">
            {deck.slides.map((slide, i) => {
              if (!slide.quiz) return null;
              const ans = answers[i];
              const correct = ans?.firstCorrect ?? false;
              return (
                <li
                  key={i}
                  className={cn(
                    'flex flex-wrap items-center gap-3 rounded-wobble-sm border-2 border-ink px-4 py-3 shadow-offset',
                    correct ? 'bg-green-soft' : 'bg-red-soft',
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper-3">
                    {correct ? (
                      <DoodleCheck className="h-4 w-4 text-green" />
                    ) : (
                      <span className="font-display text-lg font-bold text-red">✗</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">
                      {slide.quiz.question}
                    </p>
                    <p className="text-xs text-ink-soft">
                      You {ans?.firstText != null ? 'answered' : 'picked'}:{' '}
                      <span className="font-bold">
                        {ans?.firstText ??
                          (ans && typeof ans.firstChosen === 'number'
                            ? slide.quiz.options?.[ans.firstChosen]
                            : '—')}
                      </span>
                      {!correct && (
                        <>
                          {' '}
                          · Correct:{' '}
                          <span className="font-bold">
                            {slide.quiz.answer ??
                              (slide.quiz.options && typeof slide.quiz.correctIndex === 'number'
                                ? slide.quiz.options[slide.quiz.correctIndex]
                                : '—')}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => onReviewSlide(i)}
                    className="micro rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1 text-ink transition-transform hover:-translate-y-0.5"
                  >
                    Slide {i + 1}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* action cards */}
      <motion.div
        className="mt-10 flex flex-col gap-3 sm:flex-row"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.1 } } }}
      >
        {seed && !passed ? (
          <>
            <motion.div
              className="flex-1"
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            >
              <button
                type="button"
                onClick={onReplay}
                className="flex h-full w-full flex-col gap-1 rounded-wobble-2 border-2 border-ink bg-yellow p-5 text-left shadow-offset transition-transform hover:-translate-y-1"
              >
                <Chip kind="repo-ref" className="w-fit">
                  Lesson {seed.lessonSeq} of {seed.lessonSeqTotal}
                </Chip>
                <span className="mt-1 flex items-center gap-2 font-heading text-lg font-bold text-ink">
                  Try this lesson again
                  <RotateCcw className="h-5 w-5" />
                </span>
                <span className="text-sm text-ink-soft">
                  Score {Math.round(PASS_THRESHOLD * 100)}% or more to mark it completed and
                  unlock the next one.
                </span>
              </button>
            </motion.div>
            <motion.div
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            >
              <Link to={`/repos/${seed.repoSlug}`}>
                <SketchButton variant="secondary" size="lg">
                  Back to repository
                </SketchButton>
              </Link>
            </motion.div>
          </>
        ) : hasNextLesson && seed ? (
          <>
            <motion.div
              className="flex-1"
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            >
              <Link
                to={`/repos/${seed.repoSlug}`}
                className="flex h-full flex-col gap-1 rounded-wobble-2 border-2 border-ink bg-yellow p-5 no-underline shadow-offset transition-transform hover:-translate-y-1"
              >
                <Chip kind="repo-ref" className="w-fit">
                  Lesson {seed.lessonSeq + 1} of {seed.lessonSeqTotal}
                </Chip>
                <span className="mt-1 flex items-center gap-2 font-heading text-lg font-bold text-ink">
                  Next: Lesson {seed.lessonSeq + 1}
                  {nextLessonTitle ? ` — ${nextLessonTitle}` : ''}
                  <ArrowRight className="h-5 w-5" />
                </span>
                <span className="text-sm text-ink-soft">
                  Back in the repository — your memory of Lessons 1–
                  {seed.lessonSeq} comes with you.
                </span>
              </Link>
            </motion.div>
            <motion.div
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            >
              <Link to={`/repos/${seed.repoSlug}`}>
                <SketchButton variant="secondary" size="lg">
                  Back to repository
                </SketchButton>
              </Link>
            </motion.div>
          </>
        ) : (
          <>
            <motion.div
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            >
              <SketchButton variant="secondary" size="lg" onClick={onReplay}>
                <RotateCcw className="h-4 w-4" />
                Replay deck
              </SketchButton>
            </motion.div>
            <motion.div
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
            >
              <SketchButton variant="accent" size="lg" onClick={onExitToConfig}>
                {seed ? 'Back to repository' : 'Back to slide tools'}
              </SketchButton>
            </motion.div>
          </>
        )}
        {seed && !hasNextLesson && passed && (
          <motion.div
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
          >
            <Link to={`/repos/${seed.repoSlug}`}>
              <SketchButton variant="accent" size="lg">
                Course complete — back to repository
              </SketchButton>
            </Link>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
