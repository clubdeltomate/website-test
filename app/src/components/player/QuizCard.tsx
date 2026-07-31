import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Pencil, Plus, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TEXT_GRADE_COST, type SlideQuiz, type SlideAnnotation } from '@contracts/types';
import { isFillBlankCorrect } from '@contracts/grade';
import { SourceTag } from './SlideComponents';
import { trpc } from '@/providers/trpc';
import { DoodleCheck } from '../sketch/DoodleIcons';
import { SquiggleDivider } from '../sketch/Squiggle';
import { Kara } from './SlideComponents';
import AnnotationLayer, { type AnnTool } from './AnnotationLayer';
import AnnotationToolbar from './AnnotationToolbar';
import { rasterizeAnnotations, pageHasMarks } from './rasterize';
import { say } from '@/lib/i18n';

const LETTERS = ['A', 'B', 'C', 'D'];
/** Text answers (fill-blank / typed) get this many tries before Next unlocks. */
const MAX_TEXT_TRIES = 3;

export interface QuizAnswer {
  /** logged first-try correctness (what scoring uses) */
  firstCorrect: boolean;
  solved: boolean;
  /** mcq/mcq2 first pick */
  firstChosen?: number;
  /** fillblank/typed first text */
  firstText?: string;
}

export interface QuizCardProps {
  quiz: SlideQuiz;
  answer: QuizAnswer | null;
  /** record the first-try result (parent owns the log) */
  onAnswer: (res: { chosen?: number; text?: string; correct: boolean }) => void;
  /** called to unlock Next */
  onSolved?: () => void;
  review?: boolean;
  current: string | null;
  /** solve worksheets: the scratchpad pages (owned by the player, saved with
      the run) and a setter to update them */
  scratchPages?: SlideAnnotation[][];
  onScratchChange?: (pages: SlideAnnotation[][]) => void;
  /** solve worksheets: show the freehand scratchpad (true) or a plain box */
  scratchpad?: boolean;
  /** model that wrote the question (for the tiny attribution caption) */
  provider?: string | null;
}

/** kind defaults to mcq for older decks */
function quizKind(q: SlideQuiz): NonNullable<SlideQuiz['kind']> {
  return q.kind ?? 'mcq';
}

export default function QuizCard(props: QuizCardProps) {
  const kind = quizKind(props.quiz);
  const inner =
    kind === 'solve' ? (
      <SolveCard {...props} />
    ) : kind === 'fillblank' || kind === 'typed' ? (
      <TextAnswerCard {...props} kind={kind} />
    ) : (
      <ChoiceCard {...props} />
    );
  return (
    <div>
      {inner}
      <SourceTag provider={props.provider} kind="question" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Multiple choice (mcq = 4 options, mcq2 = 2 options)                  */
/* ------------------------------------------------------------------ */
function ChoiceCard({ quiz, answer, onAnswer, onSolved, review = false, current }: QuizCardProps) {
  const options = quiz.options ?? [];
  const correctIndex = quiz.correctIndex ?? 0;
  const [picked, setPicked] = useState<number | null>(answer?.firstChosen ?? null);
  const [solved, setSolved] = useState(answer?.solved ?? false);
  const [shakeIdx, setShakeIdx] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(answer ? 1 : 0);

  const select = useCallback(
    (i: number) => {
      if (solved || i >= options.length) return;
      const correct = i === correctIndex;
      setPicked(i);
      if (attempts === 0 && !review) onAnswer({ chosen: i, correct });
      setAttempts((a) => a + 1);
      if (correct) {
        setSolved(true);
        onSolved?.();
      } else {
        setShakeIdx(i);
        window.setTimeout(() => setShakeIdx(null), 450);
      }
    },
    [solved, correctIndex, attempts, review, onAnswer, onSolved, options.length],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) select(n - 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [select, options.length]);

  const showExplanation = attempts > 0 || answer !== null;

  return (
    <section className="mt-10" aria-label={say("Quick check quiz")}>
      <QuizHeader question={quiz.question} current={current} />
      <div
        className={cn(
          'mt-4 grid gap-3',
          options.length > 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {options.map((option, i) => {
          const isCorrect = i === correctIndex;
          const isPicked = picked === i;
          const revealedCorrect = solved && isCorrect;
          const revealedWrong = isPicked && !isCorrect && attempts > 0 && !solved;
          return (
            <motion.button
              key={i}
              onClick={() => select(i)}
              disabled={solved}
              animate={shakeIdx === i ? { x: [0, -4, 4, -4, 4, 0] } : { x: 0 }}
              transition={{ duration: 0.4 }}
              whileHover={!solved ? { y: -3 } : undefined}
              className={cn(
                'flex items-start gap-3 rounded-wobble-sm border-2 border-ink bg-paper-3 p-3.5 text-left shadow-offset transition-colors',
                revealedCorrect && 'bg-green-soft',
                revealedWrong && 'bg-red-soft',
                !solved && 'hover:bg-paper-2 cursor-pointer',
                solved && 'cursor-default',
                isPicked && !revealedCorrect && !revealedWrong && 'border-[3px]',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-xl font-bold',
                  revealedCorrect ? 'bg-green-soft' : revealedWrong ? 'bg-red-soft' : 'bg-yellow-soft',
                )}
              >
                {LETTERS[i] ?? i + 1}
              </span>
              <span className="flex-1 pt-0.5 text-[0.95rem] font-bold leading-snug text-ink">
                {option}
              </span>
              {revealedCorrect && (
                <span className="text-green">
                  <DoodleCheck className="h-6 w-6" />
                </span>
              )}
              {revealedWrong && <span className="font-display text-2xl font-bold text-red">✗</span>}
            </motion.button>
          );
        })}
      </div>
      <Explanation show={showExplanation} solved={solved} text={quiz.explanation} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Text answer (fillblank = exact match, typed = AI-graded)             */
/* ------------------------------------------------------------------ */
function TextAnswerCard({
  quiz,
  answer,
  onAnswer,
  onSolved,
  review = false,
  current,
  kind,
}: QuizCardProps & { kind: 'fillblank' | 'typed' }) {
  const [text, setText] = useState(answer?.firstText ?? '');
  const [solved, setSolved] = useState(answer?.solved ?? false);
  const [result, setResult] = useState<null | { correct: boolean; feedback?: string }>(
    answer ? { correct: answer.firstCorrect } : null,
  );
  const [attempts, setAttempts] = useState(answer ? 1 : 0);
  const [grading, setGrading] = useState(false);
  const gradeTyped = trpc.generate.gradeTyped.useMutation();

  const submit = useCallback(async () => {
    if (solved || review || grading || !text.trim()) return;
    // Grade this attempt. Typed answers are graded leniently by the AI on
    // MEANING (spelling / wording / terminology don't have to be exact — the
    // right idea counts); fill-blank checks the accepted answers.
    let res: { correct: boolean; feedback?: string };
    if (kind === 'fillblank') {
      const accepted = [quiz.answer ?? '', ...(quiz.acceptableAnswers ?? [])].filter(Boolean);
      res = { correct: isFillBlankCorrect(text, accepted) };
    } else {
      setGrading(true);
      try {
        res = await gradeTyped.mutateAsync({
          question: quiz.question,
          reference: quiz.answer ?? quiz.explanation,
          answer: text,
        });
      } catch {
        res = { correct: false, feedback: "Couldn't grade that — see the explanation." };
      } finally {
        setGrading(false);
      }
    }
    const nowAttempts = attempts + 1;
    if (attempts === 0) onAnswer({ text, correct: res.correct }); // first try is what scoring logs
    setAttempts(nowAttempts);
    setResult(res);
    // Correct → done. Otherwise the learner gets up to MAX_TEXT_TRIES attempts;
    // only once those are spent does Next unlock (they may skip on).
    if (res.correct || nowAttempts >= MAX_TEXT_TRIES) {
      setSolved(true);
      onSolved?.();
    }
  }, [solved, review, grading, text, kind, quiz, attempts, onAnswer, onSolved, gradeTyped]);

  const triesLeft = Math.max(0, MAX_TEXT_TRIES - attempts);
  const canRetry = !!result && !result.correct && !solved;

  return (
    <section className="mt-10" aria-label={say("Quick check")}>
      <QuizHeader question={quiz.question} current={current} />

      {kind === 'typed' ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={solved || grading}
          rows={3}
          placeholder={say("Type your answer…")}
          className="mt-4 w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-[0.95rem] text-ink shadow-offset outline-none focus:border-blue disabled:opacity-70"
        />
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={solved}
          placeholder={say("Type the missing word(s)…")}
          className="mt-4 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-[0.95rem] font-bold text-ink shadow-offset outline-none focus:border-blue disabled:opacity-70"
        />
      )}

      {!solved && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={submit}
            disabled={grading || !text.trim()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink px-3.5 py-1.5 font-heading text-sm font-bold text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-50',
              'bg-yellow',
            )}
          >
            <Send className="h-4 w-4" />
            {grading
              ? 'Checking…'
              : canRetry
                ? `Try again (${triesLeft} left)`
                : 'Check answer'}
          </button>
          {/* Say up front how this answer gets checked — a typed answer costs
              a coin per AI check, a fill-blank never leaves the device. */}
          {kind === 'typed' ? (
            <span className="micro text-[0.6rem] text-ink-faint">
              
              {say("✦ AI-checked ·")} {TEXT_GRADE_COST}  {say("🪙 per check")}
            </span>
          ) : (
            <span className="micro text-[0.6rem] text-ink-faint">
              
              {say("✓ checked on your device — free")}
            </span>
          )}
        </div>
      )}

      {result && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'mt-4 max-w-lg rounded-wobble-2 p-3.5 font-heading text-[0.95rem] leading-snug text-ink shadow-offset',
              result.correct ? 'bg-green-soft' : 'bg-yellow',
            )}
          >
            <span className="font-bold">
              {result.correct ? 'Correct — ' : solved ? 'Not quite — ' : 'Close, but not there yet — '}
            </span>
            {result.feedback ? `${result.feedback} ` : ''}
            {/* still has tries: nudge, don't reveal the answer yet */}
            {!result.correct && !solved && (
              <span className="mt-1 block text-sm text-ink-soft">
                {triesLeft} {triesLeft === 1 ? 'try' : 'tries'}  {say("left — you just need the right idea, not the exact words.")}
              </span>
            )}
            {/* out of tries (or correct): reveal the reference + explanation */}
            {solved && !result.correct && kind === 'fillblank' && quiz.answer && (
              <span className="block">
                
                {say("Answer:")} <span className="font-bold">{quiz.answer}</span>.
              </span>
            )}
            {solved && <span className="block text-sm text-ink-soft">{quiz.explanation}</span>}
          </motion.div>
        </AnimatePresence>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Solve (worksheet): work the problem out on a paginated blank          */
/* scratchpad (freehand), then type a final answer the AI grades.        */
/* ------------------------------------------------------------------ */
function SolveCard({
  quiz,
  answer,
  onAnswer,
  onSolved,
  review = false,
  current,
  scratchPages,
  onScratchChange,
  scratchpad = true,
}: QuizCardProps) {
  const [text, setText] = useState(answer?.firstText ?? '');
  const [solved, setSolved] = useState(answer?.solved ?? false);
  const [result, setResult] = useState<null | { correct: boolean; feedback?: string }>(
    answer ? { correct: answer.firstCorrect } : null,
  );
  const [attempts, setAttempts] = useState(answer ? 1 : 0);
  const [grading, setGrading] = useState(false);
  const gradeTyped = trpc.generate.gradeTyped.useMutation();
  const gradeVisual = trpc.generate.gradeVisual.useMutation();
  const utils = trpc.useUtils();

  // scratchpad: at least one blank page; the player owns/saves the pages
  const pages = scratchPages && scratchPages.length > 0 ? scratchPages : [[]];
  const [pageIdx, setPageIdx] = useState(0);
  const [tool, setTool] = useState<AnnTool>('pen');
  const [color, setColor] = useState('#2E2820');
  const [width, setWidth] = useState(3);
  const safePage = Math.min(pageIdx, pages.length - 1);
  const boxRef = useRef<HTMLDivElement>(null);
  const anyMarks = pages.some(pageHasMarks);

  const setPage = (i: number, marks: SlideAnnotation[]) => {
    if (review) return;
    const next = pages.map((p, j) => (j === i ? marks : p));
    onScratchChange?.(next);
  };
  const addPage = () => {
    if (review) return;
    onScratchChange?.([...pages, []]);
    setPageIdx(pages.length);
  };
  const clearPage = () => setPage(safePage, []);

  const triesLeft = Math.max(0, MAX_TEXT_TRIES - attempts);
  const canRetry = !!result && !result.correct && !solved;
  // can we submit? scratchpad mode needs drawn work; text mode needs text
  const canSubmit = scratchpad ? anyMarks : !!text.trim();

  const finishAttempt = (res: { correct: boolean; feedback?: string }, recordText: string) => {
    const nowAttempts = attempts + 1;
    if (attempts === 0) onAnswer({ text: recordText, correct: res.correct });
    setAttempts(nowAttempts);
    setResult(res);
    if (res.correct || nowAttempts >= MAX_TEXT_TRIES) {
      setSolved(true);
      onSolved?.();
    }
  };

  const submit = useCallback(async () => {
    if (solved || review || grading || !canSubmit) return;
    setGrading(true);
    try {
      if (scratchpad) {
        // grade the HANDWRITTEN work: rasterise every non-empty page → images
        const w = boxRef.current?.clientWidth ?? 680;
        const h = boxRef.current?.clientHeight ?? 440;
        const images = pages
          .filter(pageHasMarks)
          .map((p) => rasterizeAnnotations(p, w, h))
          .filter(Boolean);
        let res: { correct: boolean; feedback?: string };
        try {
          const r = await gradeVisual.mutateAsync({
            question: quiz.question,
            reference: quiz.answer ?? quiz.explanation,
            explanation: quiz.explanation,
            images,
          });
          res = { correct: r.correct, feedback: r.feedback };
          if (r.charged > 0) void utils.auth.me.invalidate();
        } catch (e) {
          res = {
            correct: false,
            feedback:
              e instanceof Error && e.message.includes('INSUFFICIENT_TOKENS')
                ? 'Not enough tokens to check your work — top up in Settings.'
                : "Couldn't check your work right now.",
          };
        }
        finishAttempt(res, '');
      } else {
        let res: { correct: boolean; feedback?: string };
        try {
          res = await gradeTyped.mutateAsync({
            question: quiz.question,
            reference: quiz.answer ?? quiz.explanation,
            answer: text,
          });
        } catch {
          res = { correct: false, feedback: "Couldn't grade that — compare with the worked solution." };
        }
        finishAttempt(res, text);
      }
    } finally {
      setGrading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved, review, grading, canSubmit, scratchpad, text, quiz, attempts, pages]);

  return (
    <section className="mt-10" aria-label={say("Solve")}>
      <SquiggleDivider className="text-pencil" />
      <h3 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <Pencil className="h-5 w-5 text-ink" strokeWidth={2} />
        
        {say("Solve it")}
      </h3>
      <p className="mt-2 text-[1.05rem] font-extrabold leading-snug text-ink">
        <Kara k="solveq" current={current}>
          {quiz.question}
        </Kara>
      </p>

      {/* worked-solution scratchpad — paginated blank pages you draw on */}
      {!review && scratchpad && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <AnnotationToolbar
              tool={tool}
              color={color}
              width={width}
              onTool={setTool}
              onColor={setColor}
              onWidth={setWidth}
              onClear={clearPage}
              hasMarks={pages[safePage].length > 0}
            />
          </div>
          <div
            ref={boxRef}
            className="relative h-[440px] w-full overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset [background-image:repeating-linear-gradient(transparent,transparent_31px,rgba(46,40,32,0.08)_32px)]"
          >
            <AnnotationLayer
              key={safePage}
              annotations={pages[safePage]}
              editable
              active
              tool={tool}
              color={color}
              width={width}
              onChange={(next) => setPage(safePage, next)}
            />
            <span className="pointer-events-none absolute right-2 top-2 rounded-wobble-sm bg-paper-2/80 px-2 py-0.5 font-mono text-[0.6rem] text-ink-faint">
              
              {say("Show your work")}
            </span>
          </div>
          {/* pagination */}
          <div className="mt-2 flex items-center justify-center gap-3 font-heading text-sm">
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
              disabled={safePage === 0}
              aria-label={say("Previous page")}
              className="rounded-wobble-sm border-2 border-ink bg-paper-3 p-1 text-ink shadow-offset disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-ink-soft">
              
              {say("Page")} {safePage + 1} / {pages.length}
            </span>
            {safePage < pages.length - 1 ? (
              <button
                type="button"
                onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))}
                aria-label={say("Next page")}
                className="rounded-wobble-sm border-2 border-ink bg-paper-3 p-1 text-ink shadow-offset"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={addPage}
                aria-label={say("Add page")}
                title={say("Add another page")}
                className="flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow px-2 py-1 font-semibold text-ink shadow-offset"
              >
                <Plus className="h-3.5 w-3.5" />  {say("Page")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Answer space ONLY when the scratchpad is off — then the typed box is
          the answer (with room). With the scratchpad on, the AI reads the
          drawn work itself, so there is no separate answer box. */}
      {!scratchpad && (
        <>
          <label className="micro mt-5 block text-ink-soft">{say("Your answer")}</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={solved || grading || review}
            rows={6}
            placeholder={say("Work through the problem and give your answer…")}
            className="mt-1 w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-[0.95rem] text-ink shadow-offset outline-none focus:border-blue disabled:opacity-70"
          />
        </>
      )}

      {!solved && !review && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={grading || !canSubmit}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-yellow px-3.5 py-1.5 font-heading text-sm font-bold text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-50',
            )}
          >
            <Send className="h-4 w-4" />
            {grading
              ? scratchpad
                ? 'Checking your work…'
                : 'Checking…'
              : canRetry
                ? `Try again (${triesLeft} left)`
                : scratchpad
                  ? 'Submit work'
                  : 'Submit answer'}
          </button>
          {scratchpad ? (
            <span className="micro text-ink-faint">{say("The AI reads your pages · 6 🪙 per check")}</span>
          ) : (
            <span className="micro text-ink-faint">
              
              {say("✦ AI-checked ·")} {TEXT_GRADE_COST}  {say("🪙 per check")}
            </span>
          )}
        </div>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'mt-4 max-w-lg rounded-wobble-2 p-3.5 font-heading text-[0.95rem] leading-snug text-ink shadow-offset',
            result.correct ? 'bg-green-soft' : 'bg-yellow',
          )}
        >
          <span className="font-bold">
            {result.correct ? 'Correct — ' : solved ? 'Not quite — ' : 'Close, but not there yet — '}
          </span>
          {result.feedback ? `${result.feedback} ` : ''}
          {!result.correct && !solved && (
            <span className="mt-1 block text-sm text-ink-soft">
              {triesLeft} {triesLeft === 1 ? 'try' : 'tries'}  {say("left —")}{' '}
              {scratchpad ? 'revise your working and resubmit.' : 'check your working and refine the answer.'}
            </span>
          )}
          {solved && !result.correct && quiz.answer && (
            <span className="block">
              
              {say("Answer:")} <span className="font-bold">{quiz.answer}</span>.
            </span>
          )}
          {solved && <span className="block text-sm text-ink-soft">{quiz.explanation}</span>}
        </motion.div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
function QuizHeader({ question, current }: { question: string; current: string | null }) {
  return (
    <>
      <SquiggleDivider className="text-pencil" />
      <h3 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <Pencil className="h-5 w-5 text-ink" strokeWidth={2} />
        
        {say("Quick check")}
      </h3>
      <p className="mt-2 text-[1.125rem] font-extrabold leading-snug text-ink">
        <Kara k="quizq" current={current}>
          {question}
        </Kara>
      </p>
    </>
  );
}

function Explanation({ show, solved, text }: { show: boolean; solved: boolean; text: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, rotate: 6, y: 8 }}
          animate={{ opacity: 1, rotate: -1.5, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className={cn(
            'mt-4 max-w-lg rounded-wobble-2 p-3.5 pt-4 font-heading text-[0.95rem] leading-snug text-ink shadow-offset',
            solved ? 'bg-green-soft' : 'bg-yellow',
          )}
        >
          {!solved && <span className="font-bold">{say("Not quite —")} </span>}
          {text}
          {!solved && (
            <span className="mt-1 block text-sm text-ink-soft">{say("Try again — you've got this.")}</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
