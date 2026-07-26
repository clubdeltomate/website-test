import { useState } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ChefHat, GraduationCap, Repeat, Store, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DoodleSparkle } from '@/components/sketch/DoodleIcons';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * About §4 — "One engine, many worlds" persona flip cards.
 * Front = education labels, back = the persona's world. 3D flip on hover
 * (rotateY 0→180deg, springy overshoot), tap-to-flip on touch.
 */

interface Persona {
  icon: LucideIcon;
  name: string;
  world: string;
  footnote: string;
  iconBg: string;
}

const PERSONAS: Persona[] = [
  {
    icon: GraduationCap,
    name: 'Teacher',
    world: 'Biology 101 → Cell energy → Photosynthesis deck + quiz',
    footnote: '…and every new lesson builds on the ones before it.',
    iconBg: 'bg-blue-soft',
  },
  {
    icon: ChefHat,
    name: 'Restaurant owner',
    world: 'Menu category → Dish → Dish story deck (ingredients, pairing, allergen note)',
    footnote: '…and every new dish deck builds on the ones before it.',
    iconBg: 'bg-yellow-soft',
  },
  {
    icon: Wrench,
    name: 'Handyman',
    world: 'Service area → Job → Safety + walkthrough deck for trainees',
    footnote: '…and every new job deck builds on the ones before it.',
    iconBg: 'bg-green-soft',
  },
  {
    icon: Store,
    name: 'Shop owner',
    world: 'Collection → Product → Showcase deck (materials, care, styling)',
    footnote: '…and every new product deck builds on the ones before it.',
    iconBg: 'bg-purple-soft',
  },
];

function FlipCard({ persona, index }: { persona: Persona; index: number }) {
  const [flipped, setFlipped] = useState(false);
  const Icon = persona.icon;

  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      aria-label={`${persona.name} card — flip to see their world`}
      className="group block h-72 w-full text-left [perspective:1200px]"
    >
      <div
        className={cn(
          'relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d]',
          'group-hover:[transform:rotateY(180deg)]',
        )}
        style={{
          transitionTimingFunction: 'cubic-bezier(.34,1.56,.64,1)',
          transform: flipped ? 'rotateY(180deg)' : undefined,
        }}
      >
        {/* front — education labels */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col rounded-wobble-' + String((index % 4) + 1),
            'border-2 border-ink bg-paper-3 p-5 shadow-offset [backface-visibility:hidden]',
          )}
        >
          <span className={cn('flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink', persona.iconBg)}>
            <Icon className="h-6 w-6 text-ink" strokeWidth={2} />
          </span>
          <h3 className="mt-3 font-heading text-xl text-ink">{persona.name}</h3>
          <p className="mt-2 font-mono text-sm text-ink-soft">
            Unit → Lesson → Objective
          </p>
          <span className="micro mt-auto inline-flex items-center gap-1.5 text-ink-faint">
            <Repeat className="h-3.5 w-3.5 transition-transform duration-300 group-hover:rotate-180" />
            flip me
          </span>
          {/* ✦ at the flip axis */}
          <DoodleSparkle className="absolute -right-2 top-1/2 h-5 w-5 -translate-y-1/2 text-purple opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        </div>

        {/* back — their world */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col rounded-wobble-' + String(((index + 1) % 4) + 1),
            'border-2 border-ink bg-yellow-soft p-5 shadow-offset [backface-visibility:hidden]',
            '[transform:rotateY(180deg)]',
          )}
        >
          <p className="micro text-ink-faint">{persona.name}'s world</p>
          <p className="mt-2 font-heading text-[1.05rem] leading-snug text-ink">
            {persona.world}
          </p>
          <p className="mt-auto flex items-start gap-1.5 text-xs text-ink-soft">
            <DoodleSparkle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple" />
            {persona.footnote}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function PersonaCards() {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {PERSONAS.map((p, i) => (
        <motion.div
          key={p.name}
          initial={reduced ? false : { opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, delay: reduced ? 0 : i * 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <FlipCard persona={p} index={i} />
        </motion.div>
      ))}
    </div>
  );
}
