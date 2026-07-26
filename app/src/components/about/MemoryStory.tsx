import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DoodleCheck, DoodleSparkle } from '@/components/sketch/DoodleIcons';
import StickyNote from '@/components/sketch/StickyNote';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

/**
 * About §3 — Cross-lesson memory, visualized. Pinned 160vh scrubbed scene:
 *  Phase 1: L1 plays, its lesson-log card slides out.
 *  Phase 2: the log folds into a "PREVIOUSLY TAUGHT" chip strip that
 *           flies up and docks above L2.
 *  Phase 3: L2's deck shows "re-explaining basics" struck out in red and
 *           replaced by a green one-clause stitch.
 * GSAP-only component. Reduced motion / mobile: three sequential panels
 * with fade-ins (about.md — responsive).
 */

const CAPTIONS = [
  'Lesson 1 finishes. Its log is saved.',
  "Lesson 2's generation reads every earlier log.",
  'New depth, zero repetition — like a later chapter.',
];

function LessonCard({
  seq,
  title,
  lines,
  dim,
  className,
  children,
}: {
  seq: string;
  title: string;
  lines: string;
  dim?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'w-[300px] rounded-wobble-sm border-2 bg-paper-3 p-4 shadow-offset',
        dim ? 'border-dashed border-pencil opacity-60' : 'border-ink',
        className,
      )}
    >
      <p className="micro text-ink-faint">{seq}</p>
      <p className="font-heading font-bold leading-snug text-ink">{title}</p>
      <p className="mt-1 text-xs text-ink-soft">{lines}</p>
      {children}
    </div>
  );
}

function LogCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-[280px] rounded-wobble-2 border-2 border-ink bg-yellow-soft p-4 shadow-offset',
        className,
      )}
    >
      <p className="micro flex items-center gap-1.5 text-ink">
        <DoodleSparkle className="h-3.5 w-3.5 text-purple" />
        Lesson log · L1
      </p>
      <ul className="mt-2 space-y-1.5 text-xs text-ink">
        <li className="flex items-start gap-1.5">
          <DoodleCheck className="mt-0.5 h-3 w-3 shrink-0 text-green" />
          <span>
            <b>Speed vs. velocity</b> — taught with a bus-stop analogy · quiz ✓
          </span>
        </li>
        <li className="flex items-start gap-1.5">
          <DoodleCheck className="mt-0.5 h-3 w-3 shrink-0 text-green" />
          <span>
            <b>Acceleration</b> — taught with a slope chart · quiz ✓
          </span>
        </li>
        <li className="flex items-start gap-1.5">
          <DoodleCheck className="mt-0.5 h-3 w-3 shrink-0 text-green" />
          <span>
            <b>Reading x–t graphs</b> — taught with a sketch diagram · quiz ✓
          </span>
        </li>
      </ul>
    </div>
  );
}

function TaughtStrip({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-wobble-sm border-2 border-ink bg-purple-soft px-3 py-1.5 shadow-offset',
        className,
      )}
    >
      <DoodleSparkle className="h-4 w-4 shrink-0 text-purple" />
      <span className="micro text-ink">Previously taught</span>
      <span className="text-xs text-ink-soft">L1 · describing motion</span>
    </div>
  );
}

/** The struck "re-explaining basics" + green stitch (phase 3 payload) */
function DeckReveal() {
  return (
    <div className="deck-reveal mt-3 border-t-2 border-dashed border-pencil pt-3">
      <p className="relative inline-block text-xs text-ink-faint">
        <span className="strike-text opacity-70">
          “Let's start from scratch: velocity is distance over time…”
        </span>
        <svg
          viewBox="0 0 220 10"
          preserveAspectRatio="none"
          className="strike-line absolute left-0 top-1/2 h-2.5 w-full -translate-y-1/2 text-red"
          aria-hidden="true"
        >
          <path
            d="M2 6 C 60 2, 160 9, 218 4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
          />
        </svg>
      </p>
      <p className="green-stitch mt-2 rounded-wobble-sm border-2 border-dotted border-green bg-green-soft px-2 py-1 text-xs text-ink">
        <DoodleCheck className="mr-1 inline h-3 w-3 text-green" />
        “With velocity &amp; acceleration from Lesson 1 in hand, a{' '}
        <b>force</b> is whatever changes them…”
      </p>
    </div>
  );
}

export default function MemoryStory() {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mm = gsap.matchMedia();

    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
      const q = (s: string) => root.querySelector(s);
      const qa = (s: string) => root.querySelectorAll(s);

      // initial states (pre-paint)
      gsap.set(q('.mem-log'), { autoAlpha: 0, x: 0 });
      gsap.set(q('.mem-strip'), { autoAlpha: 0, x: 330, y: -160, scale: 0.7, transformOrigin: 'left center' });
      gsap.set(q('.deck-reveal'), { autoAlpha: 0 });
      gsap.set(q('.strike-line path'), { strokeDashoffset: 1 });
      gsap.set(q('.green-stitch'), { autoAlpha: 0, y: 8 });
      gsap.set(qa('.mem-cap'), { autoAlpha: 0 });
      gsap.set(q('.mem-sparkle'), { scale: 0, transformOrigin: 'center' });

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: '+=160%',
          scrub: 0.5,
          pin: true,
          anticipatePin: 1,
        },
      });

      /* Phase 1 (0–33%): log slides out of L1 */
      tl.to(q('.mem-cap-1'), { autoAlpha: 1, duration: 0.04 }, 0.0);
      tl.to(q('.mem-log'), { autoAlpha: 1, duration: 0.04 }, 0.03);
      tl.to(q('.mem-log'), { x: 330, duration: 0.2, ease: 'power2.inOut' }, 0.07);
      tl.to({}, { duration: 0.06 }, 0.27);

      /* Phase 2 (33–66%): log folds, strip flies up and docks above L2 */
      tl.to(q('.mem-cap-1'), { autoAlpha: 0, duration: 0.04 }, 0.34);
      tl.to(q('.mem-cap-2'), { autoAlpha: 1, duration: 0.04 }, 0.4);
      tl.to(
        q('.mem-log'),
        { rotationX: -92, transformOrigin: 'top center', autoAlpha: 0, duration: 0.12, ease: 'power1.in' },
        0.36,
      );
      tl.to(q('.mem-strip'), { autoAlpha: 1, duration: 0.03 }, 0.44);
      // curved flight: out, then up, then settle
      tl.to(q('.mem-strip'), { keyframes: [
        { x: 380, y: -120, scale: 0.85, duration: 0.06, ease: 'power1.out' },
        { x: 120, y: -30, scale: 0.95, duration: 0.07, ease: 'power1.inOut' },
        { x: 0, y: 0, scale: 1, duration: 0.05, ease: 'back.out(1.6)' },
      ] }, 0.47);

      /* Phase 3 (66–100%): deck reveal, strike, green stitch, sparkle */
      tl.to(q('.mem-cap-2'), { autoAlpha: 0, duration: 0.04 }, 0.66);
      tl.to(q('.mem-cap-3'), { autoAlpha: 1, duration: 0.04 }, 0.72);
      tl.to(q('.deck-reveal'), { autoAlpha: 1, duration: 0.06 }, 0.68);
      tl.to(q('.strike-line path'), { strokeDashoffset: 0, duration: 0.08 }, 0.74);
      tl.to(q('.green-stitch'), { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power2.out' }, 0.82);
      tl.to(q('.mem-sparkle'), { scale: 1, duration: 0.04, ease: 'back.out(3)' }, 0.9);
    });

    // Fallback: sequential panels fade in on scroll
    mm.add('(max-width: 767px), (prefers-reduced-motion: reduce)', () => {
      gsap.utils.toArray<HTMLElement>(root.querySelectorAll('.mem-panel')).forEach((p) => {
        gsap.from(p, {
          autoAlpha: 0,
          y: 30,
          duration: 0.6,
          ease: 'power2.out',
          scrollTrigger: { trigger: p, start: 'top 80%' },
        });
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      aria-label="Cross-lesson memory"
      className="relative flex min-h-[100dvh] flex-col justify-center overflow-hidden px-6 py-16"
    >
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="text-center font-heading text-3xl text-ink md:text-4xl">
          Lesson 2 <span className="squiggle-red">never re-teaches</span> Lesson 1
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-ink-soft">
          Finished plays write lesson logs back to the repo. The next generation
          reads them — and builds on them.
        </p>

        {/* ---------------- pinned scrubbed stage (desktop, no-preference) ---------------- */}
        <div className="hidden motion-safe:md:block">
          <div className="relative mx-auto mt-10 h-[560px] w-full max-w-3xl">
            {/* lesson stack */}
            <LessonCard
              seq="Lesson 1 of 9 · Unit 1"
              title="Describing motion"
              lines="position · velocity · acceleration"
              className="mem-l1 absolute left-0 top-0"
            />
            <div className="absolute left-0 top-[190px]">
              <TaughtStrip className="mem-strip absolute -top-11 left-0" />
              <LessonCard
                seq="Lesson 2 of 9 · Unit 1"
                title="Forces & Newton's laws"
                lines="what changes motion, and why"
              >
                <DeckReveal />
              </LessonCard>
            </div>
            <LessonCard
              seq="Lesson 3 of 9 · Unit 2"
              title="Energy & work"
              lines="generated after L2 — memory intact"
              dim
              className="mem-l3 absolute left-0 top-[420px]"
            />
            {/* connector dashes */}
            <div className="absolute left-[38px] top-[120px] h-[70px] border-l-2 border-dashed border-pencil" aria-hidden="true" />
            <div className="absolute left-[38px] top-[350px] h-[70px] border-l-2 border-dashed border-pencil" aria-hidden="true" />

            {/* the travelling log card */}
            <LogCard className="mem-log absolute left-0 top-0" />

            {/* sparkle pop at the end */}
            <DoodleSparkle className="mem-sparkle absolute left-[320px] top-[190px] h-6 w-6 text-purple" />

            {/* sticky side note */}
            <StickyNote rotate={2} className="absolute right-0 top-6 w-52 text-sm">
              Same for restaurants: the “Dinner” decks never re-introduce your
              café's story that “Breakfast” already told.
            </StickyNote>

            {/* captions */}
            <div className="absolute -bottom-4 left-0 right-0 text-center">
              {CAPTIONS.map((c, i) => (
                <p
                  key={c}
                  className={cn(
                    'mem-cap absolute inset-x-0 font-display text-3xl text-ink',
                    `mem-cap-${i + 1}`,
                  )}
                >
                  {c}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* ---------------- sequential panels (mobile / reduced motion) ---------------- */}
        <div className="motion-safe:md:hidden">
          <div className="mx-auto mt-10 flex max-w-md flex-col gap-8">
            <div className="mem-panel">
              <LessonCard
                seq="Lesson 1 of 9 · Unit 1"
                title="Describing motion"
                lines="position · velocity · acceleration"
                className="w-full"
              />
              <LogCard className="mt-3 w-full" />
              <p className="mt-3 text-center font-display text-2xl text-ink">{CAPTIONS[0]}</p>
            </div>
            <div className="mem-panel">
              <TaughtStrip />
              <p className="mt-3 text-center font-display text-2xl text-ink">{CAPTIONS[1]}</p>
            </div>
            <div className="mem-panel">
              <LessonCard
                seq="Lesson 2 of 9 · Unit 1"
                title="Forces & Newton's laws"
                lines="what changes motion, and why"
                className="w-full"
              >
                <DeckReveal />
              </LessonCard>
              <p className="mt-3 text-center font-display text-2xl text-ink">{CAPTIONS[2]}</p>
              <StickyNote rotate={-1.5} className="mt-4 text-sm">
                Same for restaurants: the “Dinner” decks never re-introduce your
                café's story that “Breakfast” already told.
              </StickyNote>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
