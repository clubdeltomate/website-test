import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  GraduationCap,
  CookingPot,
  Wrench,
  ShoppingBag,
  BookOpen,
  Compass,
  Newspaper,
  Sparkles,
  Hand,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { cn } from '@/lib/utils';
import type { ContentSource, LessonSeed, RepoTemplate } from '@contracts/types';

/* ------------------------------------------------------------------ */
/* Template meta — one engine, four label skins (lesson-path.md §1)    */
/* ------------------------------------------------------------------ */

export interface TemplateMeta {
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** label-mapping caption shown on picker cards / chips */
  caption: string;
  unitNoun: string;
  lessonNoun: string;
  objectiveNoun: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  audiencePlaceholder: string;
}

export const TEMPLATE_META: Record<RepoTemplate, TemplateMeta> = {
  course: {
    label: 'Course',
    icon: GraduationCap,
    caption: 'Units → Lessons → Objectives',
    unitNoun: 'Unit',
    lessonNoun: 'Lesson',
    objectiveNoun: 'Objective',
    subjectLabel: 'Course topic',
    subjectPlaceholder: 'e.g. Intro to fractions for curious 10-year-olds',
    audiencePlaceholder: 'e.g. curious 10-year-olds',
  },
  restaurant: {
    label: 'Restaurant',
    icon: CookingPot,
    caption: 'Categories → Dishes → Stories',
    unitNoun: 'Category',
    lessonNoun: 'Dish',
    objectiveNoun: 'Story',
    subjectLabel: 'Restaurant concept',
    subjectPlaceholder: 'e.g. Cozy trattoria — truffle risotto is the star',
    audiencePlaceholder: 'e.g. hungry first-timers',
  },
  service: {
    label: 'Service',
    icon: Wrench,
    caption: 'Service areas → Jobs → Walkthroughs',
    unitNoun: 'Service area',
    lessonNoun: 'Job',
    objectiveNoun: 'Walkthrough',
    subjectLabel: 'Service business',
    subjectPlaceholder: 'e.g. Handy Ana — plumbing, electrics, flat-packs',
    audiencePlaceholder: 'e.g. new homeowners',
  },
  shop: {
    label: 'Shop',
    icon: ShoppingBag,
    caption: 'Collections → Products → Showcases',
    unitNoun: 'Collection',
    lessonNoun: 'Product',
    objectiveNoun: 'Showcase',
    subjectLabel: 'Shop collection',
    subjectPlaceholder: 'e.g. Hand-thrown ceramics — mugs & bowls',
    audiencePlaceholder: 'e.g. gift hunters',
  },
  walkthrough: {
    label: 'Walkthrough',
    icon: Compass,
    caption: 'Sections → Topics → Explanations',
    unitNoun: 'Section',
    lessonNoun: 'Topic',
    objectiveNoun: 'Explanation',
    subjectLabel: 'What to walk through',
    subjectPlaceholder: 'e.g. How our onboarding works, explained end to end',
    audiencePlaceholder: 'e.g. brand-new users',
  },
  news: {
    label: 'News',
    icon: Newspaper,
    caption: 'Sections → Stories → Briefings',
    unitNoun: 'Section',
    lessonNoun: 'Story',
    objectiveNoun: 'Briefing',
    subjectLabel: 'News beat',
    subjectPlaceholder: 'e.g. This week in tech & AI — the biggest stories',
    audiencePlaceholder: 'e.g. busy readers who want the gist',
  },
  other: {
    label: 'Other',
    icon: BookOpen,
    caption: 'Units → Lessons → Objectives',
    unitNoun: 'Unit',
    lessonNoun: 'Lesson',
    objectiveNoun: 'Objective',
    subjectLabel: 'Subject',
    subjectPlaceholder: 'e.g. Anything you want to teach or show',
    audiencePlaceholder: 'e.g. new hires',
  },
};

/** Icon-circle background per category — one color per template, shared by
 *  repo cards and slide-tool cards so both galleries read the same way. */
export const TEMPLATE_CIRCLE_BG: Record<string, string> = {
  course: 'bg-yellow-soft',
  restaurant: 'bg-red-soft',
  service: 'bg-blue-soft',
  shop: 'bg-green-soft',
  walkthrough: 'bg-purple-soft',
  news: 'bg-orange/25',
  other: 'bg-paper-2',
};

export function TemplateIcon({
  template,
  className,
}: {
  template: RepoTemplate;
  className?: string;
}) {
  const Icon = TEMPLATE_META[template]?.icon ?? BookOpen;
  return <Icon className={cn('h-[18px] w-[18px]', className)} strokeWidth={2} />;
}

/**
 * "Made with AI" / "Made by hand" authorship sticker — one definition shared by
 * repo cards and slide-tool cards so they always look identical.
 */
export function SourceBadge({ source, compact = false }: { source: ContentSource; compact?: boolean }) {
  if (source === 'ai') {
    return (
      <span
        title="Generated with AI"
        className="inline-flex items-center gap-1 rounded-wobble-sm border-2 border-purple bg-purple-soft px-1.5 py-0.5 font-heading text-[0.6rem] font-bold text-purple"
      >
        <Sparkles className="h-3 w-3" strokeWidth={2.5} />
        {!compact && 'Made with AI'}
      </span>
    );
  }
  return (
    <span
      title="Hand-built by a person"
      className="inline-flex items-center gap-1 rounded-wobble-sm border-2 border-green bg-green-soft px-1.5 py-0.5 font-heading text-[0.6rem] font-bold text-green"
    >
      <Hand className="h-3 w-3" strokeWidth={2.5} />
      {!compact && 'Made by hand'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Small data helpers                                                  */
/* ------------------------------------------------------------------ */

export function relTime(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Debounce a changing value (search inputs, live estimates) */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** The repo → slide-tool handoff link (api-contracts.md — seed handoff format) */
export function studyUrl(toolSlug: string, seed: LessonSeed): string {
  return `/slides/${toolSlug}?seed=${encodeURIComponent(JSON.stringify(seed))}`;
}

/* ------------------------------------------------------------------ */
/* Progress strip — one segment per lesson (repos.md §2)               */
/* ------------------------------------------------------------------ */

export function ProgressStrip({
  played,
  total,
  noun = 'lessons',
  label = 'played',
  className,
}: {
  played: number;
  total: number;
  /** what each segment represents (for the aria label) */
  noun?: string;
  /** trailing word after the count, e.g. "played" or "done" */
  label?: string;
  className?: string;
}) {
  const clampedTotal = Math.max(1, total);
  const clampedPlayed = Math.max(0, Math.min(played, clampedTotal));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="flex h-2.5 flex-1 gap-[3px]"
        role="img"
        aria-label={`${clampedPlayed} of ${clampedTotal} ${noun} ${label}`}
      >
        {Array.from({ length: clampedTotal }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex-1 rounded-full border border-ink/50',
              i < clampedPlayed
                ? 'bg-green'
                : i === clampedPlayed
                  ? 'animate-low-pulse bg-yellow'
                  : 'bg-paper-2',
            )}
          />
        ))}
      </div>
      <span className="micro whitespace-nowrap text-[0.62rem] text-ink-faint">
        {clampedPlayed}/{clampedTotal} {label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Score bar — mini ink progress bar for table cells (design.md §7.5)  */
/* ------------------------------------------------------------------ */

export function ScoreBar({
  correct,
  total,
  className,
}: {
  correct: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="relative block h-2 w-16 overflow-hidden rounded-full border border-ink bg-paper-2">
        <span
          className={cn(
            'block h-full',
            pct >= 70 ? 'bg-green' : pct >= 40 ? 'bg-yellow' : 'bg-red',
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono text-xs font-bold text-ink">{pct}%</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Toaster — sticky-note styled sonner, mounted per page               */
/* ------------------------------------------------------------------ */

export function SketchToaster() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#FFFDF6',
          border: '2px solid #2E2820',
          color: '#2E2820',
          fontFamily: 'Nunito, sans-serif',
          fontWeight: 700,
          borderRadius: '12px 6px 14px 6px / 6px 14px 6px 12px',
          boxShadow: '4px 4px 0 rgba(46,40,32,.14)',
        },
      }}
    />
  );
}
