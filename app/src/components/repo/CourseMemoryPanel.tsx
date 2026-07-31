import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import Chip from '@/components/sketch/Chip';
import WashiTape from '@/components/sketch/WashiTape';
import { DoodleCheck, DoodleSparkle } from '@/components/sketch/DoodleIcons';
import { trpc } from '@/providers/trpc';
import type { CourseMemoryEntry } from '@contracts/types';
import { say } from '@/lib/i18n';

/**
 * Course memory panel (repository.md §4) — the flagship "Previously taught"
 * folded logbook: one taped entry per completed lesson with its taught
 * summaries and best score.
 */
export default function CourseMemoryPanel({ slug }: { slug: string }) {
  const memory = trpc.repos.courseMemory.useQuery({ slug });
  const entries = memory.data ?? [];
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <section className="relative rounded-wobble-3 border-2 border-dashed border-purple/60 bg-purple-soft/50 p-5 pt-7">
      <WashiTape color="blue" rotate={-3} className="left-1/2 -translate-x-1/2" />

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <DoodleSparkle className="h-5 w-5 shrink-0 text-purple" />
        <h2 className="flex-1 font-heading text-xl font-bold text-ink">
          
          {say("Course memory — what earlier decks taught")}
        </h2>
        {entries.length > 0 && (
          <Chip kind="neutral" className="font-mono">
            {entries.length}
          </Chip>
        )}
        <ChevronDown
          className={cn('h-5 w-5 text-ink transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              {memory.isLoading && (
                <div className="flex flex-col gap-2" aria-label={say("Loading course memory")}>
                  <div className="skeleton-stroke h-10 w-2/3" />
                  <div className="skeleton-stroke h-10 w-1/2" />
                  <p className="text-sm text-ink-faint">{say("Unfolding the logbook…")}</p>
                </div>
              )}

              {memory.isError && (
                <p className="text-sm text-red">
                  
                  {say("Couldn't read the course memory.")}{' '}
                  <button
                    type="button"
                    className="squiggle-red font-bold"
                    onClick={() => void memory.refetch()}
                  >
                    
                    {say("Try again")}
                  </button>
                </p>
              )}

              {memory.isSuccess && entries.length === 0 && (
                <p className="text-sm text-ink-soft">
                  
                  {say("Play Lesson 1 to start the course memory. Every deck after it will build on what's been taught — never re-explaining it.")}{' '}
                  <DoodleSparkle className="inline h-4 w-4 text-purple" />
                </p>
              )}

              {entries.length > 0 && (
                <>
                  <ol className="flex flex-col gap-2.5">
                    {entries.map((entry, i) => (
                      <MemoryRow
                        key={entry.lessonSeq}
                        entry={entry}
                        index={i}
                        isLatest={i === entries.length - 1}
                        expanded={expanded === entry.lessonSeq}
                        onToggle={() =>
                          setExpanded((cur) => (cur === entry.lessonSeq ? null : entry.lessonSeq))
                        }
                      />
                    ))}
                  </ol>
                  <p className="micro mt-3 text-[0.62rem] text-ink-faint">
                    
                    {say("Fed into the next lesson's generation as PREVIOUSLY TAUGHT context ✦")}
                  </p>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function MemoryRow({
  entry,
  index,
  isLatest,
  expanded,
  onToggle,
}: {
  entry: CourseMemoryEntry;
  index: number;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          'flex w-full flex-wrap items-center gap-2 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-left shadow-offset transition-all hover:-translate-y-0.5',
          isLatest && 'bg-yellow-soft/60',
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-green-soft">
          <DoodleCheck className="h-3.5 w-3.5 text-green" />
        </span>
        <span className="font-mono text-xs font-bold text-ink">{say("L")}{entry.lessonSeq}</span>
        <span className="min-w-0 flex-1 truncate font-heading text-sm font-semibold text-ink">
          {entry.lessonTitle}
        </span>
        <span className="micro text-[0.6rem] text-ink-faint">
          
          {say("taught")} {entry.timesTaught}{say("× · best")} {entry.bestScoreCorrect}/{entry.bestScoreTotal}
        </span>
        <Chip kind={entry.lastLevel} className="text-[0.6rem]">
          {entry.lastLevel}
        </Chip>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0, rotate: 4 }}
            animate={{ height: 'auto', opacity: 1, rotate: -1 }}
            exit={{ height: 0, opacity: 0, rotate: 4 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-6 mt-2 rounded-wobble-2 border-2 border-ink bg-yellow p-4 font-heading text-sm leading-snug text-ink shadow-offset">
              <p className="micro mb-1.5 text-[0.6rem] text-ink-soft">
                
                {say("Previously taught ·")} {entry.unitTitle}
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {entry.summaries.slice(0, 4).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              {entry.summaries.length === 0 && (
                <p>{say("Deck finished — summary folded into memory.")}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
