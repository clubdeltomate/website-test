import { motion } from 'framer-motion';
import { Coins } from 'lucide-react';
import Chip from '@/components/sketch/Chip';
import SketchCard from '@/components/sketch/SketchCard';
import WashiTape from '@/components/sketch/WashiTape';
import { DoodleCheck } from '@/components/sketch/DoodleIcons';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * About §5 — Roles ladder + honest tokens. Framer Motion only.
 * Left: Guest → User → Moderator → Admin rows cascading over a staircase doodle.
 * Right: the token-economy card with a coin that spins once on enter.
 */

const ROLES: { kind: 'guest' | 'user' | 'moderator' | 'admin'; label: string; power: string }[] = [
  { kind: 'guest', label: 'Guest', power: 'Browse the shelf, the gallery and this page, and try the Coach.' },
  { kind: 'user', label: 'User', power: 'Build repos and decks, play and be graded, bring your own AI keys, buy tokens.' },
  {
    kind: 'moderator',
    label: 'Moderator',
    power: 'See everyone’s runs, flag content, credit manual payments — and, once verified, hand their own work to a learner.',
  },
  {
    kind: 'admin',
    label: 'Admin',
    power: 'Grant the verified badge, assign anything to anyone, set token prices and packs, hold the platform keys and flags.',
  },
];

const TOKEN_POINTS = [
  'See the cost before you spend — every generation is quoted on its own button.',
  'Text is what costs; bring your own AI key and it costs nothing. Pictures are priced per image.',
  'Playing is free. Only the AI marking of a written answer is charged, and you are told before you start.',
  'Top-ups are manual and human — pay via our Google Sheet, a moderator credits you, done.',
];

/** Hand-drawn ascending staircase doodle behind the roles */
function StaircaseDoodle() {
  return (
    <svg
      viewBox="0 0 120 160"
      className="absolute -left-2 bottom-0 h-full w-16 text-pencil"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 152h28v-32h28v-32h28V56h24"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="5 6"
      />
      <path d="M104 64l14-10 2 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RolesTokens() {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* roles ladder */}
      <div className="relative pl-14">
        <StaircaseDoodle />
        <h3 className="font-heading text-2xl text-ink">Who gets what</h3>
        <ol className="mt-4 flex flex-col gap-3">
          {ROLES.map((r, i) => (
            <motion.li
              key={r.kind}
              initial={reduced ? false : { opacity: 0, x: -24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.45, delay: reduced ? 0 : i * 0.09, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-start gap-3 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 p-3"
              style={{ marginLeft: `${i * 14}px` }}
            >
              <Chip kind={r.kind} className="mt-0.5 shrink-0 capitalize">
                {r.label}
              </Chip>
              <p className="text-sm text-ink-soft">{r.power}</p>
            </motion.li>
          ))}
        </ol>
      </div>

      {/* tokens card */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <SketchCard index={2} className="relative h-full pt-7">
          <WashiTape rotate={-3} />
          <h3 className="flex items-center gap-2 font-heading text-2xl text-ink">
            Generation runs on tokens
            <motion.span
              initial={reduced ? false : { rotate: 0 }}
              whileInView={{ rotate: 360 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
              className="inline-flex"
            >
              <Coins className="h-6 w-6 text-orange" strokeWidth={2} />
            </motion.span>
          </h3>
          <ul className="mt-4 flex flex-col gap-3">
            {TOKEN_POINTS.map((t) => (
              <li key={t} className="flex items-start gap-2 text-[0.95rem] text-ink">
                <DoodleCheck className="mt-1 h-4 w-4 shrink-0 text-green" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t-2 border-dashed border-pencil pt-3 text-xs text-ink-faint">
            Simple on purpose. No card forms, no lock-in.
          </p>
        </SketchCard>
      </motion.div>
    </div>
  );
}
