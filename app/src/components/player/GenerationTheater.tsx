import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import SketchButton from '../sketch/SketchButton';
import { DoodleCheck } from '../sketch/DoodleIcons';

export interface GenerationTheaterProps {
  slideCount: number;
  topic: string;
  /** true once the generate.slides mutation has resolved */
  done: boolean;
  /** fired ~600ms after the last slide stamps in */
  onComplete: () => void;
  onCancel: () => void;
  /** owner is publishing a preset — changes the completion copy */
  settingPreset?: boolean;
}

const STATUS_LINES = [
  'Sketching slide {n} of {total}…',
  'Drawing the charts…',
  'Writing your quizzes…',
  'Inking the margins…',
  'Taping in the pictures…',
  'Sharpening pencils…',
];

/**
 * STATE B — generation theater (slide-tool.md §B): a fanned stack of blank
 * frames on the left; ALL of the deck's slide cards are shown as placeholders
 * and a "loading" highlight cycles around them (1→2→…→N→1) until the API
 * resolves, then every card stamps complete and hands off to the player.
 */
export default function GenerationTheater({
  slideCount,
  topic,
  done,
  onComplete,
  onCancel,
  settingPreset = false,
}: GenerationTheaterProps) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);
  const [stamped, setStamped] = useState(false);

  // cycle the "loading" highlight around every card while we wait
  useEffect(() => {
    if (done || reduced) return;
    const t = window.setInterval(() => setActive((a) => (a + 1) % slideCount), 420);
    return () => window.clearInterval(t);
  }, [done, slideCount, reduced]);

  // rotate the status line
  useEffect(() => {
    if (done) return;
    const t = window.setInterval(() => setStatusIdx((s) => s + 1), 1600);
    return () => window.clearInterval(t);
  }, [done]);

  // on done: stamp the check + hand off to the player
  useEffect(() => {
    if (!done) return;
    const t1 = window.setTimeout(() => setStamped(true), 200);
    const t2 = window.setTimeout(onComplete, reduced ? 200 : 900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [done, onComplete, reduced]);

  const status = STATUS_LINES[statusIdx % STATUS_LINES.length]
    .replace('{n}', String(active + 1))
    .replace('{total}', String(slideCount));

  return (
    <motion.div
      initial={{ rotateY: reduced ? 0 : 8, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="mx-auto w-full max-w-[960px] px-4 py-10"
      aria-live="polite"
    >
      <h1 className="text-center font-display text-4xl font-bold text-ink">
        Dealing your deck…
      </h1>
      <p className="mx-auto mt-1 max-w-md truncate text-center text-sm text-ink-soft">
        {topic} · {slideCount} slides
      </p>

      <div className="mt-8 flex items-start gap-6">
        {/* fanned stack of blanks */}
        <div className="relative hidden h-40 w-28 shrink-0 sm:block" aria-hidden="true">
          {[-8, -2, 4].map((rot, i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 shadow-offset"
              style={{ transform: `rotate(${rot}deg) translateY(${i * 2}px)` }}
            />
          ))}
        </div>

        {/* one card per slide that WILL be generated */}
        <div className="flex min-h-[160px] flex-1 flex-wrap items-center gap-3">
          {Array.from({ length: slideCount }).map((_, i) => {
            const isActive = !done && i === active;
            return (
              <motion.div
                key={i}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{
                  opacity: done ? 1 : isActive ? 1 : 0.5,
                  scale: isActive ? 1.06 : 1,
                  y: 0,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                className={cn(
                  'relative flex h-36 w-24 flex-col gap-2 rounded-wobble-sm border-2 bg-paper-3 p-2.5 shadow-offset',
                  done
                    ? 'border-green'
                    : isActive
                      ? 'border-ink'
                      : 'border-dashed border-pencil',
                )}
              >
                <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[0.6rem] text-ink-faint">
                  {i + 1}
                </span>
                <motion.div
                  animate={{ width: isActive || done ? '80%' : '55%' }}
                  transition={{ duration: 0.35 }}
                  className={cn('h-2.5 rounded-full', done ? 'bg-green' : 'bg-ink/80')}
                />
                <div className="skeleton-stroke h-1.5 w-full" />
                <div className="skeleton-stroke h-1.5 w-5/6" />
                <div className="skeleton-stroke h-1.5 w-4/6" />
                <div className="mt-auto rounded-sm border border-dashed border-pencil bg-paper-2 p-1">
                  <div
                    className={cn(
                      'h-6 w-full rounded-sm',
                      done ? 'bg-green-soft' : 'bg-yellow-soft/70',
                    )}
                  />
                </div>
              </motion.div>
            );
          })}

          {/* green check stamp on completion */}
          {stamped && (
            <motion.span
              initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14 }}
              className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-green bg-green-soft text-green"
              aria-label="Deck ready"
            >
              <DoodleCheck className="h-7 w-7" />
            </motion.span>
          )}
        </div>
      </div>

      <p
        className={cn(
          'mt-8 text-center font-display text-3xl text-ink-soft',
          !done && 'animate-pulse',
        )}
      >
        {done
          ? settingPreset
            ? 'Preset ready — back to the repo…'
            : 'Deck complete — opening the player…'
          : status}
      </p>

      {!done && (
        <div className="mt-6 text-center">
          <SketchButton variant="ghost" onClick={onCancel}>
            Cancel (refund &amp; back)
          </SketchButton>
        </div>
      )}
    </motion.div>
  );
}
