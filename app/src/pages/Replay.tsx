import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, X, ChevronLeft, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import SketchButton from '@/components/sketch/SketchButton';
import Chip from '@/components/sketch/Chip';
import WashiTape from '@/components/sketch/WashiTape';
import SlideComponentView from '@/components/player/SlideComponents';
import AnnotationLayer from '@/components/player/AnnotationLayer';
import { say } from '@/lib/i18n';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/**
 * Read-only replay of a past presentation run — the exact stored deck with
 * the student's recorded answers, navigable slide by slide like a reviewable
 * post. Distinct from the live player: nothing is saved, quizzes are shown
 * with the recorded pick and the correct answer revealed.
 */
export default function Replay() {
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Go back to wherever the viewer actually CAME from — the Slides page, the
  // repo, the gallery, anywhere. Only a direct link (no in-app history, the
  // router's 'default' entry) falls back to the run's repo.
  const cameFromApp = location.key !== 'default';
  const id = Number(runId);
  const replay = trpc.runs.replay.useQuery({ runId: id }, { enabled: Number.isFinite(id), retry: false });
  const [idx, setIdx] = useState(0);

  if (replay.isLoading) {
    return <div className="mx-auto max-w-[900px] px-4 py-16 text-center text-ink-faint">{say("Loading replay…")}</div>;
  }
  if (replay.isError || !replay.data) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-16 text-center">
        <p className="font-display text-3xl text-ink">{say("Can't replay this run")}</p>
        <p className="mt-2 text-ink-soft">
          {replay.error?.message ?? 'This run could not be found.'}
        </p>
        <Link to="/repos" className="mt-4 inline-block">
          <SketchButton variant="secondary">
            <ChevronLeft className="h-4 w-4" />  {say("Back to repos")}
          </SketchButton>
        </Link>
      </div>
    );
  }

  const data = replay.data;
  const slides = data.deck?.slides ?? [];
  // Send the viewer back where the run came from — its repo — not the
  // admin-only Presentation runs dashboard. Standalone tool runs fall back to
  // the repos list.
  const backHref = data.repoSlug ? `/repos/${data.repoSlug}` : '/repos';
  const backLabel = data.repoSlug ? 'Back to repo' : 'Back to repos';
  const goBack = () => {
    if (cameFromApp) navigate(-1);
    else navigate(backHref);
  };

  if (slides.length === 0) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-16 text-center">
        <p className="font-display text-3xl text-ink">{say("Nothing to replay")}</p>
        <p className="mt-2 text-ink-soft">
          
          {say("This run was recorded before decks were snapshotted, so its slides aren't available to replay.")}
        </p>
        <Link to={backHref} className="mt-4 inline-block">
          <SketchButton variant="secondary">
            <ChevronLeft className="h-4 w-4" /> {backLabel}
          </SketchButton>
        </Link>
      </div>
    );
  }

  const safeIdx = Math.min(idx, slides.length - 1);
  const slide = slides[safeIdx];
  const answer = data.answers[safeIdx];
  const hasQuiz = !!slide.quiz;

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6 lg:px-8">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SketchButton variant="ghost" size="sm" onClick={goBack} title={say("Back to where you came from")}>
          <ChevronLeft className="h-4 w-4" />  {say("Back")}
        </SketchButton>
        <Chip kind="repo-ref">#{data.repoRef ?? data.toolSlug}</Chip>
        <span className="font-heading font-semibold text-ink">{data.toolName}</span>
        {data.lessonTitle && <span className="text-ink-soft">· {data.lessonTitle}</span>}
        <span className="ml-auto flex items-center gap-2">
          <Chip kind={data.level} className="capitalize">
            {data.level}
          </Chip>
          <span className="micro text-ink-faint">
            
            {say("played by")} {data.playerName} · {data.scoreCorrect}/{data.scoreTotal}
          </span>
        </span>
      </div>

      {/* progress dots */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIdx(i)}
            aria-label={`Slide ${i + 1}`}
            className={cn(
              'h-2.5 w-2.5 rounded-full border-2 border-ink transition-transform hover:scale-125',
              i === safeIdx ? 'bg-yellow' : data.answers[i]?.correct === false ? 'bg-red-soft' : 'bg-paper-3',
            )}
          />
        ))}
      </div>

      {/* slide stage */}
      <div className="relative min-h-[420px] rounded-wobble-2 border-2 border-ink bg-paper p-6 shadow-offset">
        <WashiTape rotate={-2} className="left-1/2 -translate-x-1/2" />
        <AnimatePresence mode="wait">
          <motion.div
            key={safeIdx}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="relative mx-auto max-w-[720px]"
          >
            <div className="micro mb-1 text-ink-faint">
              
              {say("Slide")} {safeIdx + 1}  {say("of")} {slides.length}
            </div>
            <h1 className="mb-4 font-display text-4xl font-bold text-ink">{slide.title}</h1>
            <div className="flex flex-col gap-4">
              {slide.components.map((c, ci) => (
                <SlideComponentView key={ci} component={c} ci={ci} current={null} />
              ))}
            </div>

            {/* the freehand marks the player left on this slide (read-only) */}
            {data.annotations && (
              <AnnotationLayer
                annotations={data.annotations.slides[safeIdx] ?? []}
                editable={false}
                captureWidth={data.annotations.w}
              />
            )}

            {/* recorded quiz answer */}
            {hasQuiz && slide.quiz && (
              <div className="mt-6 rounded-wobble-2 border-2 border-ink bg-paper-3 p-4">
                <p className="mb-3 font-heading text-lg font-bold text-ink">{slide.quiz.question}</p>
                {/* text answers (fillblank/typed) have no options — show recorded vs correct */}
                {!slide.quiz.options || slide.quiz.options.length === 0 ? (
                  <div className="flex flex-col gap-2 text-sm">
                    <div
                      className={cn(
                        'rounded-wobble-sm border-2 px-3 py-2',
                        answer?.correct ? 'border-green bg-green-soft' : 'border-red bg-red-soft',
                      )}
                    >
                      <span className="micro text-ink-faint">{say("Your answer:")} </span>
                      <span className="text-ink">{answer?.chosenOption ?? '—'}</span>
                    </div>
                    {slide.quiz.answer && (
                      <div className="rounded-wobble-sm border-2 border-pencil bg-paper px-3 py-2">
                        <span className="micro text-ink-faint">{say("Reference:")} </span>
                        <span className="text-ink">{slide.quiz.answer}</span>
                      </div>
                    )}
                  </div>
                ) : (
                <div className="flex flex-col gap-2">
                  {slide.quiz.options.map((opt, oi) => {
                    const isCorrect = oi === slide.quiz!.correctIndex;
                    const isChosen = answer?.chosenOption === opt;
                    return (
                      <div
                        key={oi}
                        className={cn(
                          'flex items-center gap-2 rounded-wobble-sm border-2 px-3 py-2 text-sm',
                          isCorrect
                            ? 'border-green bg-green-soft'
                            : isChosen
                              ? 'border-red bg-red-soft'
                              : 'border-pencil bg-paper',
                        )}
                      >
                        {isCorrect ? (
                          <Check className="h-4 w-4 shrink-0 text-green" />
                        ) : isChosen ? (
                          <X className="h-4 w-4 shrink-0 text-red" />
                        ) : (
                          <span className="h-4 w-4 shrink-0" />
                        )}
                        <span className="text-ink">{opt}</span>
                        {isChosen && (
                          <span className="micro ml-auto text-ink-faint">{say("your pick")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
                {answer?.chosenOption == null && (
                  <p className="micro mt-2 text-ink-faint">{say("No answer was recorded for this slide.")}</p>
                )}
              </div>
            )}

            {/* worked-solution scratchpad pages the learner drew (read-only) */}
            {data.annotations?.scratch?.[safeIdx] && data.annotations.scratch[safeIdx].length > 0 && (
              <div className="mt-6">
                <p className="micro mb-2 text-ink-faint">
                  
                  {say("Worked solution ·")} {data.annotations.scratch[safeIdx].length}  {say("page")}
                  {data.annotations.scratch[safeIdx].length === 1 ? '' : 's'}
                </p>
                {data.annotations.scratch[safeIdx].map((page, pi) => (
                  <div
                    key={pi}
                    className="relative mb-3 h-[440px] w-full overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-3 [background-image:repeating-linear-gradient(transparent,transparent_31px,rgba(46,40,32,0.08)_32px)]"
                  >
                    <AnnotationLayer
                      annotations={page}
                      editable={false}
                      captureWidth={data.annotations!.w}
                    />
                    <span className="pointer-events-none absolute right-2 top-2 rounded-wobble-sm bg-paper-2/80 px-2 py-0.5 font-mono text-[0.6rem] text-ink-faint">
                      
                      {say("Page")} {pi + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* nav */}
      <div className="mt-5 flex items-center justify-between">
        <SketchButton
          variant="secondary"
          disabled={safeIdx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="h-4 w-4" />  {say("Back")}
        </SketchButton>
        {safeIdx < slides.length - 1 ? (
          <SketchButton variant="accent" onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))}>
            
            {say("Next")} <ArrowRight className="h-4 w-4" />
          </SketchButton>
        ) : (
          <SketchButton variant="accent" onClick={goBack}>
            <PlayCircle className="h-4 w-4" />  {say("Done reviewing")}
          </SketchButton>
        )}
      </div>
    </div>
  );
}
