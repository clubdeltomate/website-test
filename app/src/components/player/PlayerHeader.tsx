import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, LayoutTemplate, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LessonSeed, SlidePlanInfo } from '@contracts/types';
import { TEMPLATE_COMPONENT_LABELS, type TemplateComponentType } from '@contracts/slide-templates';
import Chip from '../sketch/Chip';
import TemplateBar from '../templates/TemplateBar';
import { DoodleSparkle } from '../sketch/DoodleIcons';
import type { ReadAloudStatus } from './useReadAloud';

export interface PlayerHeaderProps {
  title: string;
  seed: LessonSeed | null;
  /** "PREVIOUSLY TAUGHT" block returned by generate.slides */
  previouslyTaught: string | null;
  index: number;
  total: number;
  readAloud: {
    supported: boolean;
    status: ReadAloudStatus;
    toggle: () => void;
  };
  /** admin-only diagnostics: the current slide's layout + the memory badge */
  isAdmin?: boolean;
  layout?: SlidePlanInfo | null;
  onExit: () => void;
}

/** Pencil-tip head for the deck progress bar (design.md §7.11) */
function PencilTip({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 26 14"
      className={cn('h-3.5 w-[26px]', className)}
      fill="none"
      aria-hidden="true"
    >
      <path d="M2 3h14l8 4-8 4H2z" fill="#FFC53D" stroke="#2E2820" strokeWidth="1.8" />
      <path d="M16 3l8 4-8 4z" fill="#F4EBD6" stroke="#2E2820" strokeWidth="1.6" />
      <path d="M21 5.6l3 1.4-3 1.4z" fill="#2E2820" />
    </svg>
  );
}

/**
 * Player chrome (slide-tool.md §C1): deck title, seeded context chip,
 * "Building on L1…N ✦" pill, slide counter, read-aloud, exit — plus the
 * deck progress bar with a pencil-tip head.
 */
export default function PlayerHeader({
  title,
  seed,
  previouslyTaught,
  index,
  total,
  readAloud,
  isAdmin = false,
  layout = null,
  onExit,
}: PlayerHeaderProps) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const pct = total > 0 ? ((index + 1) / total) * 100 : 0;
  const memoryLines = previouslyTaught
    ? previouslyTaught.split('\n').filter(Boolean)
    : [];

  return (
    <div className="sticky top-0 z-20 border-b-2 border-ink bg-paper-3/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-2 px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate font-heading text-lg font-semibold text-ink sm:text-xl">
          {title}
        </h2>

        {seed && (
          <Chip kind="repo-ref" className="shrink-0">
            #{seed.repoRef} · Lesson {seed.lessonSeq} of {seed.lessonSeqTotal}
          </Chip>
        )}

        {/* admin-only: prior-lessons memory badge */}
        {isAdmin && seed && seed.lessonSeq > 1 && (
          <button
            onClick={() => setMemoryOpen((o) => !o)}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-wobble-sm border-2 px-2 py-0.5 text-xs font-bold transition-colors',
              memoryOpen
                ? 'border-ink bg-purple-soft text-ink'
                : 'border-dashed border-purple text-purple hover:bg-purple-soft',
            )}
            aria-expanded={memoryOpen}
          >
            <DoodleSparkle className="h-3.5 w-3.5" />
            Building on L1–{seed.lessonSeq - 1}
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', memoryOpen && 'rotate-180')}
            />
          </button>
        )}

        {/* admin-only: which layout template this slide uses */}
        {isAdmin && layout && (
          <button
            onClick={() => setLayoutOpen((o) => !o)}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-wobble-sm border-2 px-2 py-0.5 text-xs font-bold transition-colors',
              layoutOpen
                ? 'border-ink bg-blue-soft text-ink'
                : 'border-dashed border-blue text-blue hover:bg-blue-soft',
            )}
            aria-expanded={layoutOpen}
            title="Which layout template the AI used for this slide"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            {layout.pinned ? 'Pinned' : 'Layout'}: {layout.template ?? 'custom'}
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', layoutOpen && 'rotate-180')}
            />
          </button>
        )}

        <span className="shrink-0 font-mono text-sm font-bold text-ink">
          {index + 1} / {total}
        </span>

        <button
          onClick={readAloud.toggle}
          disabled={!readAloud.supported}
          aria-label={
            readAloud.status === 'playing' ? 'Pause read-aloud' : 'Read this slide aloud'
          }
          title={
            readAloud.supported
              ? readAloud.status === 'playing'
                ? 'Pause read-aloud'
                : 'Read aloud'
              : 'Read-aloud not supported in this browser'
          }
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-wobble-sm border-2 transition-all',
            readAloud.status !== 'off'
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-ink bg-paper-3 text-ink hover:bg-paper-2',
            !readAloud.supported && 'opacity-40 cursor-not-allowed',
          )}
        >
          {readAloud.status === 'playing' ? (
            <VolumeX className="h-5 w-5" strokeWidth={2} />
          ) : (
            <Volume2 className="h-5 w-5" strokeWidth={2} />
          )}
        </button>

        <button
          onClick={onExit}
          aria-label="Exit player"
          title="Exit (Esc)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-wobble-sm border-2 border-ink bg-paper-3 text-ink transition-colors hover:bg-red-soft"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>

      {/* memory drawer */}
      <AnimatePresence>
        {memoryOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t-2 border-dashed border-pencil bg-purple-soft/50"
          >
            <div className="mx-auto max-w-[1080px] px-4 py-3">
              {memoryLines.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {memoryLines.map((line, i) => (
                    <li
                      key={i}
                      className="rounded-wobble-sm border-2 border-dashed border-purple/50 bg-paper-3 px-3 py-1.5 text-xs leading-relaxed text-ink"
                    >
                      {line.replace(/^-\s*/, '')}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-soft">
                  Prior lessons exist in this repo — this deck assumes their
                  material and builds straight on top of it.
                </p>
              )}
              <p className="micro mt-2 text-ink-faint">
                This deck references that material — it doesn't re-teach it.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* admin-only: layout diagnostic drawer */}
      <AnimatePresence>
        {layoutOpen && layout && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t-2 border-dashed border-pencil bg-blue-soft/40"
          >
            <div className="mx-auto max-w-[1080px] px-4 py-3">
              <p className="mb-2 text-xs font-bold text-ink">
                {layout.pinned
                  ? `You pinned "${layout.template}" for this slide — the AI was told to build exactly this configuration:`
                  : `The AI composed this slide as "${layout.template ?? 'a custom layout'}" (closest matching template):`}
              </p>
              <TemplateBar components={layout.components as TemplateComponentType[]} />
              <p className="micro mt-2 text-ink-faint">
                {layout.pinned
                  ? 'Recipe: ' +
                    layout.components
                      .map((c) => TEMPLATE_COMPONENT_LABELS[c as TemplateComponentType] ?? c)
                      .join(' → ') +
                    '. If a piece is missing here, the model failed to follow the pin — regenerate.'
                  : 'This is inferred from the slide’s components, not a pin. Use Advanced options on the setup screen to pin a layout.'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* deck progress bar (design.md §7.11) */}
      <div className="relative h-[14px]">
        <div className="absolute inset-x-0 top-1/2 h-0 -translate-y-1/2 border-t-[3px] border-dashed border-pencil" />
        <motion.div
          className="absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-r-full bg-ink"
          initial={false}
          animate={{ width: `calc(${pct}% - 10px)` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2"
          initial={false}
          animate={{ left: `calc(${pct}% - 22px)` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <PencilTip />
        </motion.div>
      </div>
    </div>
  );
}
