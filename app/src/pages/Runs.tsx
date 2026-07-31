import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ChevronDown,
  Download,
  Flag,
  FlagOff,
  LibraryBig,
  PlayCircle,
  Search,
  Target,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import SketchTable, { type SketchColumn } from '@/components/sketch/SketchTable';
import Chip from '@/components/sketch/Chip';
import EmptyState from '@/components/sketch/EmptyState';
import WashiTape from '@/components/sketch/WashiTape';
import { DoodleSparkle } from '@/components/sketch/DoodleIcons';
import { usePrefersReducedMotion } from '@/components/about/usePrefersReducedMotion';
import { LEVELS, type Level, type RunRow, type RunSlideDetail } from '@contracts/types';
import { say } from '@/lib/i18n';

const PAGE_SIZE = 5;
const EASE_OUT = [0.22, 1, 0.36, 1] as [number, number, number, number];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeDay(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function scorePct(r: RunRow): number {
  return r.scoreTotal > 0 ? Math.round((100 * r.scoreCorrect) / r.scoreTotal) : 0;
}

function scoreTextClass(pct: number): string {
  if (pct >= 80) return 'text-green';
  if (pct < 50) return 'text-red';
  return 'text-ink';
}

function scoreBarClass(pct: number): string {
  if (pct >= 80) return 'bg-green';
  if (pct < 50) return 'bg-red';
  return 'bg-ink';
}

/** Count-up number, 800ms ease-out (design.md §6); jumps to final under reduced motion */
function CountUp({
  value,
  format,
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 800);
      setDisplay(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  return <>{format ? format(display) : Math.round(display).toLocaleString()}</>;
}

/** Mini ink progress bar for score cells (design.md §7.5) */
function ScoreBar({ pct, index }: { pct: number; index: number }) {
  const reduced = usePrefersReducedMotion();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-2 w-16 overflow-hidden rounded-full border border-ink bg-paper-2">
        <motion.span
          className={cn('block h-full', scoreBarClass(pct))}
          initial={reduced ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, delay: reduced ? 0 : index * 0.03, ease: EASE_OUT }}
        />
      </span>
      <span className={cn('font-mono text-xs font-bold', scoreTextClass(pct))}>
        {pct}%
      </span>
    </span>
  );
}

/** Hand-drawn caret for sortable headers (matches SketchTable) */
function SortCaret({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  return (
    <svg
      viewBox="0 0 10 12"
      className={cn(
        'h-3 w-3 transition-transform duration-200',
        active && dir === -1 && 'rotate-180',
        !active && 'opacity-35',
      )}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1.5 8.5C3.5 6 5 4 5.2 2.2c.4 1.6 1.6 4 3.3 6.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Hand-drawn toggle switch (design.md §7.4) */
function SketchToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 font-heading text-sm text-ink"
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full border-2 border-ink transition-colors duration-200',
          checked ? 'bg-yellow' : 'bg-paper-3',
        )}
      >
        <motion.span
          className="absolute left-0.5 h-4 w-4 rounded-full border-2 border-ink bg-paper-3 shadow-[1px_1px_0_rgba(46,40,32,.25)]"
          animate={{ x: checked ? 20 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Types for local state                                               */
/* ------------------------------------------------------------------ */

type SortKey = 'played' | 'score' | 'elapsed';
type RangeKey = 'today' | '7d' | '30d' | 'all';

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'all', label: 'All' },
];

const FLAG_REASONS = [
  'Inappropriate content',
  'Spam or abuse',
  'Off-topic deck',
  'Other',
];

/* ------------------------------------------------------------------ */
/* Stats strip (runs.md §1)                                            */
/* ------------------------------------------------------------------ */

interface RunStats {
  plays: number;
  avgScore: number;
  totalSec: number;
  activeRepos: number;
}

function StatsStrip({ stats, scopeLabel }: { stats: RunStats; scopeLabel: string }) {
  const reduced = usePrefersReducedMotion();
  const cards = [
    {
      icon: Trophy,
      label: 'Completed runs',
      value: <CountUp value={stats.plays} />,
      accent: 'text-ink',
    },
    {
      icon: Target,
      label: 'Average score',
      value: (
        <span className="inline-flex items-center gap-3">
          <CountUp value={stats.avgScore} format={(n) => `${Math.round(n)}%`} />
          <span className="hidden h-2 w-14 overflow-hidden rounded-full border border-ink bg-paper-2 sm:inline-block">
            <span
              className={cn('block h-full', scoreBarClass(stats.avgScore))}
              style={{ width: `${stats.avgScore}%` }}
            />
          </span>
        </span>
      ),
      accent: scoreTextClass(stats.avgScore),
    },
    {
      icon: Timer,
      label: 'Total study time',
      value: (
        <CountUp
          value={stats.totalSec}
          format={(n) => {
            const mins = Math.floor(n / 60);
            if (mins < 60) return `${mins}m`;
            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
          }}
        />
      ),
      accent: 'text-ink',
    },
    {
      icon: LibraryBig,
      label: 'Active repos',
      value: <CountUp value={stats.activeRepos} />,
      accent: 'text-ink',
    },
  ];

  return (
    <section aria-label={say("Run statistics")}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={reduced ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: reduced ? 0 : i * 0.07, ease: EASE_OUT }}
            className={cn(
              'rounded-wobble-' + String((i % 4) + 1),
              'border-2 border-ink bg-paper-3 p-4 shadow-offset',
            )}
          >
            <div className="flex items-center justify-between">
              <p className="micro text-ink-faint">{c.label}</p>
              <c.icon className="h-[18px] w-[18px] text-ink-soft transition-transform duration-300 hover:rotate-2" strokeWidth={2} />
            </div>
            <p className={cn('mt-1 font-display text-4xl font-bold leading-none', c.accent)}>
              {c.value}
            </p>
          </motion.div>
        ))}
      </div>
      <p className="micro mt-2 text-ink-faint">{scopeLabel}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Run detail drawer (runs.md §3)                                      */
/* ------------------------------------------------------------------ */

function DrawerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dashed border-pencil py-2.5 last:border-b-0">
      <span className="micro pt-0.5 text-ink-faint">{label}</span>
      <span className="text-right text-sm text-ink">{children}</span>
    </div>
  );
}

function RunDrawer({
  run,
  isStaff,
  flagPending,
  onClose,
  onFlag,
  onUnflag,
}: {
  run: RunRow;
  isStaff: boolean;
  flagPending: boolean;
  onClose: () => void;
  onFlag: () => void;
  onUnflag: () => void;
}) {
  const pct = scorePct(run);
  const detail = trpc.runs.get.useQuery({ runId: run.id });

  return (
    <motion.div
      className="fixed inset-0 z-[85]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden="true" />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`Run #${run.id} details`}
        className="absolute right-0 top-0 flex h-full w-[min(480px,100vw)] flex-col overflow-y-auto border-l-2 border-ink bg-paper-3 shadow-offset"
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="relative p-6 pt-8">
          <WashiTape rotate={-3} className="left-8" />
          <button
            onClick={onClose}
            aria-label={say("Close run details")}
            className="absolute right-4 top-4 rounded-wobble-sm border-2 border-transparent p-1.5 text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>

          <p className="font-mono text-xs font-bold text-ink-faint">
            
            {say("RUN #")}{run.id} · {fmtDate(run.completedAt)}
          </p>
          <h2 className="mt-1 font-heading text-2xl text-ink">{run.toolName}</h2>
          <p className="text-sm text-ink-soft">
            
            {say("played by")} <span className="font-bold text-ink">{run.playerName}</span>
          </p>

          {/* score header */}
          <div className="mt-5 rounded-wobble-2 border-2 border-ink bg-paper-2 p-4 text-center">
            <p className={cn('font-display text-6xl font-bold leading-none', scoreTextClass(pct))}>
              {pct}%
            </p>
            <p className="mt-1 font-mono text-sm text-ink-soft">
              {run.scoreCorrect} / {run.scoreTotal}  {say("correct")}
            </p>
            {/* segmented score bar: correct vs missed */}
            <div className="mt-3 flex h-3 overflow-hidden rounded-full border-2 border-ink bg-paper-3">
              <motion.span
                className="block h-full bg-green"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.5, ease: EASE_OUT }}
              />
              {run.scoreTotal - run.scoreCorrect > 0 && (
                <motion.span
                  className="block h-full bg-red"
                  initial={{ width: 0 }}
                  animate={{ width: `${100 - pct}%` }}
                  transition={{ duration: 0.5, ease: EASE_OUT }}
                />
              )}
            </div>
          </div>

          {/* replay — navigate the exact played deck again, read-only */}
          <Link to={`/runs/${run.id}/replay`} className="mt-4 block no-underline">
            <SketchButton variant="accent" className="w-full">
              <PlayCircle className="h-4 w-4" />
              
              {say("Replay this presentation")}
            </SketchButton>
          </Link>

          {/* facts */}
          <div className="mt-5">
            <DrawerRow label="Elapsed">
              <span className="font-mono">{fmtElapsed(run.elapsedSec)}</span>
            </DrawerRow>
            <DrawerRow label="Slides">
              <span className="font-mono">{run.slideCount}</span>
            </DrawerRow>
            <DrawerRow label="Level">
              <Chip kind={run.level}>{run.level}</Chip>
            </DrawerRow>
            <DrawerRow label="Image style">
              <Chip kind="neutral">{run.imageStyle}</Chip>
            </DrawerRow>
          </div>

          {/* seed info */}
          <h3 className="mt-6 font-heading text-lg text-ink">{say("Lesson seed")}</h3>
          {run.repoSlug ? (
            <div className="mt-2 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip kind="repo-ref">#{run.repoRef}</Chip>
                {run.lessonTitle && (
                  <span className="text-sm font-bold text-ink">{run.lessonTitle}</span>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-soft">
                
                {say("This play wrote a lesson log back to the repo — the next lesson's generation reads it and builds on it.")}
              </p>
              <Link
                to={`/repos/${run.repoSlug}`}
                className="squiggle mt-2 inline-block text-sm font-bold"
              >
                
                {say("View repository →")}
              </Link>
            </div>
          ) : (
            <p className="mt-2 rounded-wobble-sm border-2 border-dashed border-pencil p-3 text-sm text-ink-soft">
              
              {say("Direct play — launched from the slide tool without a lesson seed.")}
            </p>
          )}

          <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-faint">
            <DoodleSparkle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple" />
            
            {say("Per-slide quiz answers are folded into the repo's Course memory panel.")}
          </p>

          {/* per-slide recap */}
          <h3 className="mt-6 font-heading text-lg text-ink">{say("Slide recap")}</h3>
          {detail.isLoading ? (
            <div className="mt-2 flex flex-col gap-2" aria-busy="true" aria-label={say("Loading slides")}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton-stroke h-9 w-full" />
              ))}
            </div>
          ) : detail.isError ? (
            <p className="mt-2 rounded-wobble-sm border-2 border-dashed border-pencil p-3 text-sm text-ink-soft">
              
              {say("Couldn't load the slide recap —")} {detail.error.message}
            </p>
          ) : detail.data && detail.data.slides.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              {detail.data.slides.map((s, i) => (
                <SlideRecap key={i} index={i} slide={s} />
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-wobble-sm border-2 border-dashed border-pencil p-3 text-sm text-ink-soft">
              
              {say("No per-slide detail was recorded for this run.")}
            </p>
          )}

          {/* moderation */}
          {isStaff && (
            <div className="mt-6 border-t-2 border-dashed border-pencil pt-4">
              <p className="micro mb-2 text-ink-faint">{say("Moderation")}</p>
              {run.flagged ? (
                <div className="flex items-center gap-3">
                  <Chip className="border-red bg-red-soft text-red">
                    <Flag className="h-3 w-3" />  {say("flagged")}
                  </Chip>
                  <SketchButton
                    variant="secondary"
                    size="sm"
                    loading={flagPending}
                    onClick={onUnflag}
                  >
                    <FlagOff className="h-4 w-4" />  {say("Remove flag")}
                  </SketchButton>
                </div>
              ) : (
                <SketchButton
                  variant="danger"
                  size="sm"
                  loading={flagPending}
                  onClick={onFlag}
                >
                  <Flag className="h-4 w-4" />  {say("Flag run")}
                </SketchButton>
              )}
            </div>
          )}
        </div>
      </motion.aside>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-slide recap accordion (run detail drawer)                       */
/* ------------------------------------------------------------------ */

function SlideRecap({ index, slide }: { index: number; slide: RunSlideDetail }) {
  const [open, setOpen] = useState(false);
  const status =
    slide.correct === true ? 'correct' : slide.correct === false ? 'missed' : 'unanswered';

  return (
    <div
      className={cn(
        'rounded-wobble-sm border-2',
        status === 'correct' && 'border-green bg-green-soft/50',
        status === 'missed' && 'border-red bg-red-soft/50',
        status === 'unanswered' && 'border-dashed border-pencil bg-paper-2/60',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="shrink-0 font-mono text-xs font-bold text-ink-faint">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          {slide.title}
        </span>
        {status === 'correct' && (
          <Chip className="border-green bg-green-soft text-green">{say("correct")}</Chip>
        )}
        {status === 'missed' && <Chip className="border-red bg-red-soft text-red">{say("missed")}</Chip>}
        {status === 'unanswered' && (
          <span className="micro text-[0.58rem] text-ink-faint">{say("no quiz")}</span>
        )}
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-ink transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t border-dashed border-pencil px-3 py-2.5 text-sm">
          {slide.components.length > 0 && (
            <p className="micro text-[0.58rem] text-ink-faint">
              
              {say("components:")} {slide.components.join(' · ')}
            </p>
          )}
          {slide.question ? (
            <>
              <p className="mt-1 font-heading font-semibold text-ink">{say("Q:")} {slide.question}</p>
              {slide.chosenOption ? (
                <p
                  className={cn(
                    'mt-1.5 inline-block rounded-wobble-sm border-2 px-2 py-0.5 text-xs font-bold',
                    slide.correct
                      ? 'border-green bg-green-soft text-green'
                      : 'border-red bg-red-soft text-red',
                  )}
                >
                  {slide.correct ? '✓' : '✗'}  {say("chose:")} {slide.chosenOption}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-ink-faint">{say("No answer recorded.")}</p>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-ink-faint">{say("No quiz question on this slide.")}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flag reason modal (runs.md — interactions)                          */
/* ------------------------------------------------------------------ */

function FlagModal({
  run,
  pending,
  onCancel,
  onConfirm,
}: {
  run: RunRow;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(FLAG_REASONS[0]);
  return (
    <motion.div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-ink/30" onClick={onCancel} aria-hidden="true" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={say("Flag run")}
        className="relative w-full max-w-md rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-8 shadow-offset"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      >
        <WashiTape rotate={-4} className="left-8" />
        <h3 className="font-display text-3xl text-ink">{say("Flag run #")}{run.id}?</h3>
        <p className="mt-1 text-sm text-ink-soft">
          
          {say("Flagged runs land in the moderation queue for review.")}
        </p>
        <label className="micro mt-4 block text-ink-faint" htmlFor="flag-reason">
          
          {say("Reason")}
        </label>
        <select
          id="flag-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-body text-sm text-ink focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB] focus:outline-none"
        >
          {FLAG_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="mt-5 flex justify-end gap-2">
          <SketchButton variant="ghost" size="sm" onClick={onCancel}>
            
            {say("Cancel")}
          </SketchButton>
          <SketchButton
            variant="danger"
            size="sm"
            loading={pending}
            onClick={() => onConfirm(reason)}
          >
            <Flag className="h-4 w-4" />  {say("Flag run")}
          </SketchButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Runs() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, isLoading: authLoading, role } = useAuth();
  const reduced = usePrefersReducedMotion();
  const isStaff = role === 'moderator' || role === 'admin';

  /* URL params pre-apply filters (runs.md — layout) */
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState(() => params.get('student') ?? '');
  const [repoFilter, setRepoFilter] = useState(() => params.get('repo') ?? '');
  const [toolFilter, setToolFilter] = useState(() => params.get('tool') ?? '');
  const [levelFilter, setLevelFilter] = useState<Level | ''>('');
  const [range, setRange] = useState<RangeKey>('all');
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: 'played',
    dir: -1,
  });
  const [page, setPage] = useState(() =>
    Math.max(1, Number(params.get('page') ?? '1') || 1),
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [flagTarget, setFlagTarget] = useState<RunRow | null>(null);

  /* data */
  const globalQ = trpc.runs.listGlobal.useQuery(
    { limit: 100, offset: 0 },
    { enabled: !!user },
  );
  const mineQ = trpc.runs.listMine.useQuery(
    { limit: 100 },
    { enabled: !!user && mineOnly },
  );
  const activeQ = mineOnly ? mineQ : globalQ;
  const rows = useMemo(() => activeQ.data ?? [], [activeQ.data]);

  const utils = trpc.useUtils();
  const flagM = trpc.runs.setFlagged.useMutation({
    onSuccess: (_d, vars) => {
      toast.success(vars.flagged ? 'Run flagged — added to the moderation queue' : 'Flag removed');
      void utils.runs.listGlobal.invalidate();
      void utils.runs.listMine.invalidate();
      setFlagTarget(null);
    },
    onError: (e) => toast.error(say(e.message)),
  });

  /* derived: repo options for the select */
  const repoOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.repoRef && r.repoSlug && !seen.has(r.repoRef)) {
        seen.set(r.repoRef, r.repoSlug);
      }
    }
    return [...seen.entries()].map(([ref, slug]) => ({ ref, slug }));
  }, [rows]);

  /* filtering */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const rangeMs: Record<RangeKey, number> = {
      today: 86_400_000,
      '7d': 7 * 86_400_000,
      '30d': 30 * 86_400_000,
      all: Infinity,
    };
    return rows.filter((r) => {
      if (repoFilter && r.repoRef !== repoFilter && r.repoSlug !== repoFilter) return false;
      if (toolFilter && r.toolSlug !== toolFilter) return false;
      if (levelFilter && r.level !== levelFilter) return false;
      if (now - r.completedAt.getTime() > rangeMs[range]) return false;
      if (scorePct(r) < minScore) return false;
      if (q) {
        const hay = `${r.toolName} ${r.playerName} ${r.repoRef ?? ''} ${r.repoSlug ?? ''} ${r.lessonTitle ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, repoFilter, toolFilter, levelFilter, range, minScore]);

  /* sorting (played default desc) */
  const sorted = useMemo(() => {
    const get: Record<SortKey, (r: RunRow) => number> = {
      played: (r) => r.completedAt.getTime(),
      score: (r) => scorePct(r),
      elapsed: (r) => r.elapsedSec,
    };
    const g = get[sort.key];
    return [...filtered].sort((a, b) => (g(a) - g(b)) * sort.dir);
  }, [filtered, sort]);

  /* pagination */
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (safePage > 1) next.set('page', String(safePage));
        else next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [safePage, setParams]);

  /* stats computed on the scope rows (not filters) */
  const stats = useMemo<RunStats>(() => {
    const plays = rows.length;
    const avgScore = plays
      ? Math.round(rows.reduce((s, r) => s + scorePct(r), 0) / plays)
      : 0;
    const totalSec = rows.reduce((s, r) => s + r.elapsedSec, 0);
    const activeRepos = new Set(rows.map((r) => r.repoSlug).filter(Boolean)).size;
    return { plays, avgScore, totalSec, activeRepos };
  }, [rows]);

  const hasFilters =
    !!search || !!repoFilter || !!toolFilter || !!levelFilter || range !== 'all' || minScore > 0;

  const clearFilters = () => {
    setSearch('');
    setRepoFilter('');
    setToolFilter('');
    setLevelFilter('');
    setRange('all');
    setMinScore(0);
    setPage(1);
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );

  /* CSV export respects current filters */
  const exportCsv = () => {
    const header = [
      'run_id', 'slide_tool', 'student', 'played_at', 'elapsed_sec', 'repo_ref',
      'lesson', 'level', 'image_style', 'slides', 'score_correct', 'score_total',
      'score_pct', 'flagged',
    ];
    const esc = (v: string | number | boolean | null) =>
      `"${String(v ?? '').replaceAll('"', '""')}"`;
    const lines = sorted.map((r) =>
      [
        r.id, r.toolName, r.playerName, r.completedAt.toISOString(), r.elapsedSec,
        r.repoRef ? `#${r.repoRef}` : 'Direct', r.lessonTitle ?? '', r.level,
        r.imageStyle, r.slideCount, r.scoreCorrect, r.scoreTotal, scorePct(r), r.flagged,
      ].map(esc).join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sketchlearn-runs.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${sorted.length} run${sorted.length === 1 ? '' : 's'} to CSV`);
  };

  /* guest wall: runs are personal data (runs.md — interactions) */
  if (!authLoading && !user) {
    return <Navigate to={`/auth?next=${encodeURIComponent('/runs')}`} replace />;
  }

  const selected = selectedId != null ? rows.find((r) => r.id === selectedId) ?? null : null;

  const sortHeader = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1 uppercase tracking-[0.12em]"
    >
      {label}
      <SortCaret active={sort.key === key} dir={sort.dir} />
    </button>
  );

  const columns: SketchColumn<RunRow>[] = [
    {
      key: 'tool',
      header: 'Slide tool',
      render: (r) => (
        <span className="flex items-center gap-2">
          {isStaff && r.flagged && (
            <Flag className="h-3.5 w-3.5 shrink-0 text-red" aria-label={say("Flagged")} />
          )}
          <Link
            to={`/slides/${r.toolSlug}`}
            onClick={(e) => e.stopPropagation()}
            className="font-bold text-ink squiggle"
          >
            {r.toolName}
          </Link>
        </span>
      ),
    },
    {
      key: 'student',
      header: 'Student',
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-sm text-ink">
            {r.playerName.charAt(0).toUpperCase()}
          </span>
          <span className="whitespace-nowrap">{r.playerName}</span>
        </span>
      ),
    },
    {
      key: 'played',
      header: sortHeader('played', 'Played'),
      mono: true,
      render: (r) => (
        <span title={relativeDay(r.completedAt)} className="whitespace-nowrap">
          {fmtDate(r.completedAt)}
        </span>
      ),
    },
    {
      key: 'elapsed',
      header: sortHeader('elapsed', 'Elapsed'),
      mono: true,
      render: (r) => fmtElapsed(r.elapsedSec),
    },
    {
      key: 'repo',
      header: 'Repo',
      render: (r) =>
        r.repoRef ? (
          <Chip kind="repo-ref">#{r.repoRef}</Chip>
        ) : (
          <Chip kind="guest">{say("Direct")}</Chip>
        ),
    },
    {
      key: 'lesson',
      header: 'Lesson',
      render: (r) =>
        r.lessonTitle ? (
          <span className="text-xs text-ink-soft">{r.lessonTitle}</span>
        ) : (
          <span className="font-mono text-xs text-ink-faint">—</span>
        ),
    },
    {
      key: 'level',
      header: 'Level',
      render: (r) => <Chip kind={r.level}>{r.level}</Chip>,
    },
    {
      key: 'style',
      header: 'Style',
      render: (r) =>
        r.imageStyle !== 'none' ? (
          <img
            src={`/style-${r.imageStyle}.svg`}
            alt={`${r.imageStyle} style`}
            title={r.imageStyle}
            className="h-7 w-10 rounded-wobble-sm border-2 border-ink object-cover"
          />
        ) : (
          <Chip kind="neutral">{say("none")}</Chip>
        ),
    },
    {
      key: 'slides',
      header: 'Slides',
      mono: true,
      render: (r) => r.slideCount,
    },
    {
      key: 'score',
      header: sortHeader('score', 'Score'),
      render: (r, i) => <ScoreBar pct={scorePct(r)} index={i} />,
    },
  ];

  const emptyTable = (
    <EmptyState
      image="/empty-runs.svg"
      imageAlt="Clipboard with an empty checklist and a sleeping pencil"
      headline="No finished runs yet"
      explainer="Runs are saved the moment a deck is completed — grab a lesson and press play."
      ctaLabel="Browse repositories"
      onCta={() => navigate('/repos')}
    />
  );

  return (
    <div className="mx-auto w-full max-w-content px-6 py-8 lg:px-8">
      {/* header */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="flex flex-wrap items-center gap-3"
      >
        <h1 className="font-display text-[32px] font-bold leading-none text-ink">
          
          {say("Presentation runs")}
        </h1>
        <Chip kind="neutral" className="font-mono">
          {filtered.length}  {say("run")}{filtered.length === 1 ? '' : 's'}
        </Chip>
        <span className="ml-auto">
          <SketchToggle
            checked={mineOnly}
            onChange={(v) => {
              setMineOnly(v);
              setPage(1);
            }}
            label="Mine only"
          />
        </span>
      </motion.div>

      {/* stats */}
      <div className="mt-6">
        <StatsStrip
          stats={stats}
          scopeLabel={mineOnly ? 'Your plays' : 'All students'}
        />
      </div>

      {/* filter bar */}
      <motion.section
        initial={reduced ? false : { opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: reduced ? 0 : 0.15, ease: EASE_OUT }}
        className="mt-6 rounded-wobble-sm border-2 border-ink bg-paper-3 p-4 shadow-offset"
        aria-label={say("Filters")}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={say("Search tool, repo or student…")}
              aria-label={say("Search runs")}
              className="w-full rounded-wobble-sm border-2 border-ink bg-paper-3 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB] focus:outline-none"
            />
          </div>

          <select
            value={repoFilter}
            onChange={(e) => {
              setRepoFilter(e.target.value);
              setPage(1);
            }}
            aria-label={say("Filter by repository")}
            className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
          >
            <option value="">{say("All repos")}</option>
            {repoOptions.map((o) => (
              <option key={o.ref} value={o.ref}>
                #{o.ref} · {o.slug}
              </option>
            ))}
          </select>

          <select
            value={levelFilter}
            onChange={(e) => {
              setLevelFilter(e.target.value as Level | '');
              setPage(1);
            }}
            aria-label={say("Filter by level")}
            className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
          >
            <option value="">{say("All levels")}</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1" role="group" aria-label={say("Date range")}>
            {RANGE_OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => {
                  setRange(o.key);
                  setPage(1);
                }}
                className={cn(
                  'rounded-wobble-sm border-2 px-2.5 py-1 font-heading text-xs transition-colors',
                  range === o.key
                    ? 'border-ink bg-yellow text-ink shadow-offset'
                    : 'border-transparent text-ink-soft hover:border-dashed hover:border-ink',
                )}
              >
                {say(o.label)}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <span className="micro text-ink-faint">{say("Score")}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={minScore}
              onChange={(e) => {
                setMinScore(Number(e.target.value));
                setPage(1);
              }}
              aria-label={`Minimum score ${minScore} percent`}
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-pencil accent-[#2E2820]"
            />
            <span className="font-mono text-xs font-bold text-ink">≥ {minScore}%</span>
          </label>

          <span className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <SketchButton variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4" />  {say("Clear all")}
              </SketchButton>
            )}
            <SketchButton
              variant="ghost"
              size="sm"
              onClick={exportCsv}
              disabled={sorted.length === 0}
            >
              <Download className="h-4 w-4" />  {say("Export CSV")}
            </SketchButton>
          </span>
        </div>

        {/* active filter chips */}
        {hasFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            {search && (
              <FilterChip label={`“${search}”`} onClear={() => setSearch('')} />
            )}
            {repoFilter && (
              <FilterChip label={`repo #${repoFilter}`} onClear={() => setRepoFilter('')} />
            )}
            {toolFilter && (
              <FilterChip label={`tool ${toolFilter}`} onClear={() => setToolFilter('')} />
            )}
            {levelFilter && (
              <FilterChip label={levelFilter} onClear={() => setLevelFilter('')} />
            )}
            {range !== 'all' && (
              <FilterChip
                label={RANGE_OPTIONS.find((o) => o.key === range)?.label ?? range}
                onClear={() => setRange('all')}
              />
            )}
            {minScore > 0 && (
              <FilterChip label={`≥ ${minScore}%`} onClear={() => setMinScore(0)} />
            )}
          </div>
        )}
      </motion.section>

      {/* content */}
      <div className="mt-6">
        {authLoading || activeQ.isLoading ? (
          <RunsSkeleton />
        ) : activeQ.isError ? (
          <EmptyState
            image="/empty-runs.svg"
            headline="The gradebook won't open"
            explainer={activeQ.error.message}
          />
        ) : sorted.length === 0 && hasFilters ? (
          <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3/60">
            <EmptyState
              image="/empty-runs.svg"
              headline="Nothing matches those filters"
              explainer="Try widening the date range or lowering the score threshold."
              ctaLabel="Clear all filters"
              onCta={clearFilters}
            />
          </div>
        ) : (
          <>
            {/* desktop table */}
            <div className="hidden md:block">
              <SketchTable
                columns={columns}
                rows={pageRows}
                rowKey={(r) => String(r.id)}
                onRowClick={(r) => setSelectedId(r.id)}
                emptyState={emptyTable}
              />
            </div>

            {/* mobile run cards */}
            <div className="flex flex-col gap-3 md:hidden">
              {pageRows.length === 0 && (
                <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3/60">
                  {emptyTable}
                </div>
              )}
              {pageRows.map((r, i) => (
                <motion.button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  initial={reduced ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: reduced ? 0 : i * 0.04, ease: EASE_OUT }}
                  className={cn(
                    'rounded-wobble-' + String((i % 4) + 1),
                    'border-2 border-ink bg-paper-3 p-4 text-left shadow-offset transition-all duration-150 hover:-translate-y-[3px] hover:shadow-offset-hover',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-heading font-bold text-ink">{r.toolName}</span>
                    {isStaff && r.flagged && <Flag className="h-4 w-4 text-red" />}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {r.playerName} · {fmtDate(r.completedAt)}
                  </p>
                  <div className="mt-2">
                    <ScoreBar pct={scorePct(r)} index={i} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-mono text-ink-soft">
                      <Timer className="h-3.5 w-3.5" />
                      {fmtElapsed(r.elapsedSec)}
                    </span>
                    <span className="font-mono text-ink-soft">{r.slideCount}  {say("slides")}</span>
                    <span>
                      {r.repoRef ? <Chip kind="repo-ref">#{r.repoRef}</Chip> : <Chip kind="guest">{say("Direct")}</Chip>}
                    </span>
                    <span>
                      <Chip kind={r.level}>{r.level}</Chip>
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>

            {/* pagination */}
            {totalPages > 1 && (
              <nav
                aria-label={say("Pagination")}
                className="mt-6 flex items-center justify-center gap-2 font-display text-2xl"
              >
                <PagerArrow
                  dir="prev"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                />
                {pagerWindow(safePage, totalPages).map((p, i) =>
                  p === '…' ? (
                    <span key={`e${i}`} className="px-1 text-ink-faint">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      aria-current={p === safePage ? 'page' : undefined}
                      className={cn(
                        'rounded-wobble-sm px-2 leading-none transition-colors',
                        p === safePage
                          ? 'marker-highlight-yellow font-bold text-ink'
                          : 'text-ink-soft hover:text-ink',
                      )}
                    >
                      {p}
                    </button>
                  ),
                )}
                <PagerArrow
                  dir="next"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                />
              </nav>
            )}
          </>
        )}
      </div>

      {/* drawer + flag modal */}
      <AnimatePresence>
        {selected && (
          <RunDrawer
            key="drawer"
            run={selected}
            isStaff={isStaff}
            flagPending={flagM.isPending}
            onClose={() => setSelectedId(null)}
            onFlag={() => setFlagTarget(selected)}
            onUnflag={() =>
              flagM.mutate({ runId: selected.id, flagged: false })
            }
          />
        )}
        {flagTarget && (
          <FlagModal
            key="flag-modal"
            run={flagTarget}
            pending={flagM.isPending}
            onCancel={() => setFlagTarget(null)}
            onConfirm={() =>
              flagM.mutate({ runId: flagTarget.id, flagged: true })
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small page-local pieces                                             */
/* ------------------------------------------------------------------ */

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="inline-flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow-soft px-2 py-0.5 text-xs font-bold text-ink"
    >
      {label}
      <button
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="rounded-full p-0.5 hover:bg-yellow"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.span>
  );
}

function PagerArrow({
  dir,
  disabled,
  onClick,
}: {
  dir: 'prev' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'prev' ? 'Previous page' : 'Next page'}
      className={cn(
        'px-2 leading-none transition-colors',
        disabled ? 'cursor-not-allowed text-pencil' : 'text-ink hover:text-blue',
      )}
    >
      {dir === 'prev' ? '←' : '→'}
    </button>
  );
}

/** "← 1 2 3 … N →" window */
function pagerWindow(page: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, page - 1, page, page + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i] - list[i - 1] > 1) out.push('…');
    out.push(list[i]);
  }
  return out;
}

/** Pencil-stroke skeleton rows + playful status line (design.md §6) */
function RunsSkeleton() {
  return (
    <div aria-busy="true" aria-label={say("Loading runs")}>
      <p className="mb-3 font-display text-2xl text-ink-faint">{say("Sharpening pencils…")}</p>
      <div className="overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset">
        <div className="skeleton-stroke h-11 rounded-none bg-yellow/60" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-t-2 border-dashed border-pencil px-3 py-3"
          >
            <div className="skeleton-stroke h-4 w-1/4" />
            <div className="skeleton-stroke h-4 w-1/6" />
            <div className="skeleton-stroke h-4 w-1/5" />
            <div className="skeleton-stroke ml-auto h-4 w-1/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
