import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cn } from '@/lib/utils';
import { say } from '@/lib/i18n';

gsap.registerPlugin(ScrollTrigger);

/**
 * About §1 — Hero: 100vh scene pinned for 150vh of scroll story.
 * Three Caveat headline lines revealed by scroll progress, then the
 * repo ⇄ slide-tool ⇄ lesson-log loop doodles draw themselves with
 * dashed arrows and ✦ sparkles. GSAP-only component (no framer-motion).
 *
 * Layout switch is pure CSS (motion-safe:md:) so the GSAP setup always
 * finds its targets: desktop + no-preference gets the pinned scrub story;
 * mobile / reduced-motion gets statically stacked lines + a fully drawn
 * diagram with simple fade-ins (about.md — responsive).
 */

const LINES = [
  'A notebook that teaches.',
  'Slides that remember.',
  'One loop for classrooms, cafés, and corner shops.',
];

function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span key={i} className="hero-word inline-block whitespace-pre">
          {w}{' '}
        </span>
      ))}
    </>
  );
}

/** The loop diagram: three object doodles + dashed triangle arrows + sparkles.
 *  Every stroke carries pathLength=1 so GSAP can scrub strokeDashoffset 1→0.
 *  The fallback branch simply sets dashoffset 0 (fully drawn). */
function LoopDiagram() {
  const stroke = {
    fill: 'none',
    stroke: '#2E2820',
    strokeWidth: 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  const dash = { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 } as const;

  return (
    <svg
      viewBox="0 0 760 400"
      className="mx-auto w-full max-w-[680px]"
      role="img"
      aria-label={say("The loop: repository, slide tool, and lesson log connected by dashed arrows")}
    >
      {/* ---- Repository notebook (left) ---- */}
      <g className="loop-node">
        <rect x="60" y="120" width="150" height="110" rx="14" {...stroke} {...dash} />
        <path d="M100 120v110" {...stroke} {...dash} />
        <path d="M116 142h70M116 162h70M116 182h48" {...stroke} strokeWidth={2.4} {...dash} />
        <path d="M74 138c6-8 12-8 16 0" {...stroke} strokeWidth={2.4} {...dash} />
      </g>
      {/* ---- Slide frames (right) ---- */}
      <g className="loop-node">
        <rect x="550" y="80" width="150" height="100" rx="12" {...stroke} {...dash} />
        <rect x="566" y="60" width="150" height="100" rx="12" {...stroke} {...dash} />
        <path d="M586 84h110M586 104h110M586 124h70" {...stroke} strokeWidth={2.4} {...dash} />
        <circle cx="678" cy="132" r="10" {...stroke} strokeWidth={2.4} {...dash} />
      </g>
      {/* ---- Lesson log logbook (bottom) ---- */}
      <g className="loop-node">
        <rect x="315" y="270" width="130" height="90" rx="12" {...stroke} {...dash} />
        <path d="M331 294h60M331 312h80M331 330h44" {...stroke} strokeWidth={2.4} {...dash} />
      </g>
      {/* yellow pencil on the logbook (filled, pops with the nodes) */}
      <path
        className="loop-pencil"
        d="M425 292l14-4 10 10-4 14-24 10-8-8z"
        fill="#FFC53D"
        stroke="#2E2820"
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      {/* ---- dashed arrows (triangle loop) ----
          pathLength=1 keeps dasharray proportional; scrub drives dashoffset travel */}
      <path
        className="loop-arrow"
        d="M212 150 C 320 90, 440 80, 548 100"
        {...stroke}
        pathLength={1}
        strokeDasharray="0.045 0.055"
      />
      <path
        className="loop-arrow"
        d="M640 184 C 610 260, 520 300, 448 306"
        {...stroke}
        pathLength={1}
        strokeDasharray="0.045 0.055"
      />
      <path
        className="loop-arrow"
        d="M312 318 C 220 300, 160 260, 148 232"
        {...stroke}
        pathLength={1}
        strokeDasharray="0.045 0.055"
      />
      {/* arrowheads */}
      <g className="loop-node">
        <path d="M548 100l-16-2M548 100l-6 14" {...stroke} strokeWidth={2.6} {...dash} />
        <path d="M448 306l14-8M448 306l16 4" {...stroke} strokeWidth={2.6} {...dash} />
        <path d="M148 232l2 16M148 232l14 8" {...stroke} strokeWidth={2.6} {...dash} />
      </g>
      {/* ✦ sparkles at the corners */}
      <g className="loop-sparkle" transform="translate(380 70)">
        <path d="M0-14l3.4 9.6L13-1l-9.6 3.4L0 12l-3.4-9.6L-13-1l9.6-3.4z" fill="#8566D4" />
      </g>
      <g className="loop-sparkle" transform="translate(726 210) scale(0.8)">
        <path d="M0-14l3.4 9.6L13-1l-9.6 3.4L0 12l-3.4-9.6L-13-1l9.6-3.4z" fill="#8566D4" />
      </g>
      <g className="loop-sparkle" transform="translate(40 260) scale(0.7)">
        <path d="M0-14l3.4 9.6L13-1l-9.6 3.4L0 12l-3.4-9.6L-13-1l9.6-3.4z" fill="#8566D4" />
      </g>
    </svg>
  );
}

export default function HeroStory() {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    const q = (s: string) => root.querySelector(s);
    const qa = (s: string) => root.querySelectorAll(s);

    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
      const lines = gsap.utils.toArray<HTMLElement>(qa('.hero-line'));
      const diagram = q('.loop-diagram');

      // initial states (pre-paint: useLayoutEffect)
      gsap.set(lines[1], { autoAlpha: 0 });
      gsap.set(lines[2], { autoAlpha: 0 });
      gsap.set(diagram, { autoAlpha: 0, y: 24 });
      gsap.set(qa('.loop-sparkle'), { scale: 0, transformOrigin: 'center' });
      gsap.set(qa('.loop-arrow'), { autoAlpha: 0, strokeDashoffset: 0.35 });
      gsap.set(qa('.loop-pencil'), { autoAlpha: 0 });
      // line 1 stays visible at the top of the page (progress 0 = already revealed)

      const wordsIn = (line: Element, at: number, tl: gsap.core.Timeline) => {
        tl.fromTo(
          line.querySelectorAll('.hero-word'),
          { y: 30, rotate: 1, autoAlpha: 0 },
          { y: 0, rotate: 0, autoAlpha: 1, stagger: 0.02, duration: 0.1, ease: 'power2.out' },
          at,
        );
      };
      const lineOut = (line: Element, at: number, tl: gsap.core.Timeline) => {
        tl.to(line, { y: -46, autoAlpha: 0, duration: 0.08, ease: 'power1.in' }, at);
      };

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: '+=150%',
          scrub: 0.5,
          pin: true,
          anticipatePin: 1,
        },
      });

      // 0–25%: line 1 is already revealed (top of page) — just hold
      tl.to({}, { duration: 0.15 });
      // 25–50%: line 1 out, line 2 in
      lineOut(lines[0], 0.17, tl);
      tl.set(lines[1], { autoAlpha: 1 }, 0.22);
      wordsIn(lines[1], 0.23, tl);
      tl.to({}, { duration: 0.12 }, 0.35);
      // 50–75%: line 2 out, line 3 in
      lineOut(lines[1], 0.47, tl);
      tl.set(lines[2], { autoAlpha: 1 }, 0.52);
      wordsIn(lines[2], 0.53, tl);
      tl.to({}, { duration: 0.08 }, 0.65);
      // 75–100%: line 3 lifts up + the loop draws itself
      tl.to(lines[2], { y: -120, scale: 0.82, duration: 0.1, ease: 'power1.inOut' }, 0.73);
      tl.to(diagram, { autoAlpha: 1, y: 0, duration: 0.06 }, 0.76);
      tl.to(qa('.loop-node path, .loop-node rect, .loop-node circle'), {
        strokeDashoffset: 0,
        stagger: 0.004,
        duration: 0.14,
      }, 0.78);
      tl.to(qa('.loop-pencil'), { autoAlpha: 1, duration: 0.03 }, 0.84);
      tl.to(qa('.loop-arrow'), {
        autoAlpha: 1,
        strokeDashoffset: 0,
        stagger: 0.03,
        duration: 0.08,
      }, 0.85);
      tl.to(qa('.loop-sparkle'), {
        scale: 1,
        stagger: 0.02,
        duration: 0.04,
        ease: 'back.out(3)',
      }, 0.93);
    });

    // Fallback: fully drawn diagram + gentle fade-ins on enter
    mm.add('(max-width: 767px), (prefers-reduced-motion: reduce)', () => {
      gsap.set(qa('.loop-node path, .loop-node rect, .loop-node circle'), {
        strokeDashoffset: 0,
      });
      gsap.from(qa('.hero-line'), {
        autoAlpha: 0,
        y: 24,
        stagger: 0.12,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: { trigger: root, start: 'top 75%' },
      });
      gsap.from(q('.loop-diagram'), {
        autoAlpha: 0,
        y: 24,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: { trigger: root, start: 'top 55%' },
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      aria-label={say("Introduction")}
      className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-6 py-16"
    >
      {/* faint static underlayer (about.md §1) */}
      <img
        src="/about-hero.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-15"
      />

      <div
        className={cn(
          'relative flex w-full max-w-4xl flex-col gap-6 text-center',
          'motion-safe:md:block motion-safe:md:h-[34vh] motion-safe:md:min-h-[220px]',
        )}
      >
        {LINES.map((line, i) => {
          const Tag = i === 0 ? 'h1' : 'p';
          return (
            <Tag
              key={line}
              className={cn(
                'hero-line font-display font-bold leading-[1.05] text-ink',
                'text-[clamp(2.6rem,6.5vw,5rem)]',
                'motion-safe:md:absolute motion-safe:md:inset-0 motion-safe:md:flex motion-safe:md:items-center motion-safe:md:justify-center',
                i === 2 && 'text-[clamp(2.2rem,5vw,4rem)]',
              )}
            >
              <Words text={line} />
            </Tag>
          );
        })}
      </div>

      <div className="loop-diagram relative mt-12 w-full motion-safe:md:mt-6">
        <LoopDiagram />
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-8 gap-y-1 font-heading text-sm text-ink-soft">
          <span>{say("📒 Repository")}</span>
          <span>{say("🎞️ Slide tool")}</span>
          <span>{say("✏️ Lesson log")}</span>
        </div>
      </div>

      {/* scroll cue */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-center text-ink-faint">
        <svg viewBox="0 0 24 40" className="mx-auto h-9 w-6 animate-bounce" fill="none" aria-hidden="true">
          <path
            d="M12 3c-1 10-1 20 0 30M5 26c2.4 3 5 6 7 8 2-2.4 4.6-5 7-8"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="micro mt-1">{say("scroll")}</p>
      </div>
    </section>
  );
}
