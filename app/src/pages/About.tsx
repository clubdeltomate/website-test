import { motion } from 'framer-motion';
import { BookOpen, Clapperboard, BrainCircuit } from 'lucide-react';
import SketchCard from '@/components/sketch/SketchCard';
import { Squiggle, Marker, SquiggleDivider } from '@/components/sketch/Squiggle';
import {
  DoodleArrow,
  DoodleSparkle,
  DoodleStar,
  DoodleSpiral,
} from '@/components/sketch/DoodleIcons';
import { SITE } from '@contracts/site';
import HeroStory from '@/components/about/HeroStory';
import MemoryStory from '@/components/about/MemoryStory';
import PersonaCards from '@/components/about/PersonaCards';
import RolesTokens from '@/components/about/RolesTokens';
import DoodleCta from '@/components/about/DoodleCanvas';
import { usePrefersReducedMotion } from '@/components/about/usePrefersReducedMotion';
import { say } from '@/lib/i18n';

const EASE_OUT = [0.22, 1, 0.36, 1] as [number, number, number, number];

/* ------------------------------------------------------------------ */
/* §2 — How it works                                                   */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: BookOpen,
    title: 'Compose the path',
    body: "Tell the Coach or the Lesson Path what you're building — a course, a menu, a service catalog. One click lays out the repository: units, lessons, a banner for each, and a deck waiting behind every lesson.",
  },
  {
    icon: Clapperboard,
    title: 'Play and be graded',
    body: "Each lesson's objective becomes a deck. Slides teach with prose, charts, tables, diagrams, sticky notes and pictures, then quiz you — multiple choice marked on the spot, written answers read by the AI. Your best run is kept.",
  },
  {
    icon: BrainCircuit,
    title: 'Remember everything',
    body: 'Finished plays write lesson logs back to the repo. The next generation reads them, so Lesson 2 builds on Lesson 1 instead of re-teaching it.',
  },
];

/** Big Caveat number with an ink circle that draws itself on scroll */
function CircledNumber({ n }: { n: number }) {
  const reduced = usePrefersReducedMotion();
  return (
    <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 h-full w-full -rotate-90 text-ink" aria-hidden="true">
        <motion.circle
          cx="28"
          cy="28"
          r="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeDasharray="1 0"
          initial={reduced ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </svg>
      <span className="font-display text-4xl font-bold text-ink">{n}</span>
    </span>
  );
}

function HowItWorks() {
  const reduced = usePrefersReducedMotion();
  return (
    <section aria-label={say("How it works")} className="relative mx-auto max-w-content px-6 py-20 lg:px-8">
      <DoodleStar className="absolute right-10 top-12 h-6 w-6 rotate-12 text-ink/40" />
      <h2 className="text-center font-heading text-3xl text-ink md:text-4xl">
        
        {say("How the")} <Squiggle>{say("loop")}</Squiggle>  {say("works")}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-center text-ink-soft">
        
        {say("Three moves, one notebook.")} <Marker>{say("Everything connects.")}</Marker>
      </p>

      <div className="relative mt-12 grid gap-8 md:grid-cols-3 md:gap-5">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.title}
            initial={reduced ? false : { opacity: 0, y: 40, rotate: 1.5 }}
            whileInView={{ opacity: 1, y: 0, rotate: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.55, delay: reduced ? 0 : i * 0.12, ease: EASE_OUT }}
            className="relative"
          >
            <SketchCard index={i} hover className="h-full">
              <div className="flex items-start justify-between">
                <CircledNumber n={i + 1} />
                <s.icon className="h-6 w-6 text-ink-soft transition-transform duration-300 hover:rotate-2" strokeWidth={2} />
              </div>
              <h3 className="mt-4 font-heading text-xl text-ink">{say(s.title)}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{s.body}</p>
            </SketchCard>
            {/* connector arrow (desktop only) */}
            {i < STEPS.length - 1 && (
              <DoodleArrow className="absolute -right-7 top-1/2 hidden h-6 w-10 -translate-y-1/2 text-ink/50 md:block" />
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* §3 — what the place is, and where things live                       */
/* ------------------------------------------------------------------ */

/** The four doors, described by the same object the marketing tool reads
 *  when it fills in a follow card — so what we say here and what we say
 *  about ourselves elsewhere cannot drift apart. */
function WhatThisIs() {
  const reduced = usePrefersReducedMotion();
  return (
    <section aria-label={`What ${SITE.name} is`} className="relative bg-paper-2/60">
      <div className="relative mx-auto max-w-content px-6 py-20 lg:px-8">
        <DoodleSparkle className="absolute right-12 top-14 h-5 w-5 text-yellow" />
        <h2 className="text-center font-heading text-3xl text-ink md:text-4xl">
          
          {say("So what")} <Squiggle>{say("is")}</Squiggle>  {say("this?")}
        </h2>
        <div className="mx-auto mt-6 flex max-w-2xl flex-col gap-3 text-center text-ink-soft">
          {SITE.what.map((line) => (
            <p key={line} className="text-[1.02rem] leading-relaxed">
              {line}
            </p>
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-lg text-center font-heading text-xl text-ink">
          
          {say("Four doors,")} <Marker>{say("one notebook.")}</Marker>
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SITE.surfaces.map((s, i) => (
            <motion.div
              key={s.label}
              initial={reduced ? false : { opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.45, delay: reduced ? 0 : i * 0.08, ease: EASE_OUT }}
            >
              <SketchCard index={i} hover className="h-full">
                <h3 className="font-heading text-lg text-ink">{s.label}</h3>
                <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-soft">{s.body}</p>
              </SketchCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section shells with margin doodles                                  */
/* ------------------------------------------------------------------ */

function PersonaSection() {
  return (
    <section aria-label={say("One engine, many worlds")} className="relative mx-auto max-w-content px-6 py-20 lg:px-8">
      <DoodleSparkle className="absolute left-8 top-16 h-5 w-5 text-purple/60" />
      <DoodleSpiral className="absolute bottom-10 right-8 h-7 w-7 text-ink/40" />
      <h2 className="text-center font-heading text-3xl text-ink md:text-4xl">
        
        {say("Same loop,")} <Marker strong>{say("any counter.")}</Marker>
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-ink-soft">
        
        {say("Units, lessons, and objectives are just labels. Flip a card to see your world.")}
      </p>
      <div className="mt-12">
        <PersonaCards />
      </div>
    </section>
  );
}

function RolesTokensSection() {
  return (
    <section aria-label={say("Roles, tokens and honest payments")} className="relative bg-paper-2/60">
      <div className="relative mx-auto max-w-content px-6 py-20 lg:px-8">
        <DoodleStar className="absolute left-10 top-10 h-5 w-5 -rotate-12 text-ink/40" />
        <h2 className="text-center font-heading text-3xl text-ink md:text-4xl">
          
          {say("Roles, tokens &")} <Squiggle color="blue">{say("honest payments")}</Squiggle>
        </h2>
        <div className="mt-12">
          <RolesTokens />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function About() {
  return (
    <div className="overflow-x-clip">
      {/* §1 — pinned scroll-story hero (GSAP, isolated) */}
      <HeroStory />

      <SquiggleDivider className="mx-auto max-w-content px-6" />

      {/* §2 — how it works */}
      <HowItWorks />

      {/* §3 — what the place is, and its four doors */}
      <WhatThisIs />

      {/* §4 — cross-lesson memory, pinned (GSAP, isolated) */}
      <MemoryStory />

      <SquiggleDivider className="mx-auto max-w-content px-6" />

      {/* §5 — persona flip cards */}
      <PersonaSection />

      {/* §6 — roles & tokens */}
      <RolesTokensSection />

      {/* §7 — doodle canvas + CTA */}
      <DoodleCta />
    </div>
  );
}
