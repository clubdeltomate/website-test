import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Inline squiggle underline (wavy hand-drawn) for key phrases (design.md §3) */
export function Squiggle({
  children,
  color = 'yellow',
  className,
}: {
  children: ReactNode;
  color?: 'yellow' | 'ink' | 'red' | 'blue';
  className?: string;
}) {
  const colors = {
    yellow: 'decoration-yellow',
    ink: 'decoration-ink',
    red: 'decoration-red',
    blue: 'decoration-blue',
  } as const;
  return (
    <span
      className={cn(
        'underline decoration-wavy decoration-2 underline-offset-[5px]',
        colors[color],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Marker highlight behind a phrase (design.md §3) — use sparingly, one phrase per section */
export function Marker({
  children,
  strong = false,
  className,
}: {
  children: ReactNode;
  /** strong = full yellow, default = yellow-soft wash */
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(strong ? 'marker-highlight-yellow' : 'marker-highlight', className)}
    >
      {children}
    </span>
  );
}

/** Wavy SVG divider line (design.md §5.6) */
export function SquiggleDivider({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 12"
      preserveAspectRatio="none"
      className={cn('h-3 w-full text-pencil', className)}
      aria-hidden="true"
    >
      <path
        d="M0 6 Q 12.5 0, 25 6 T 50 6 T 75 6 T 100 6 T 125 6 T 150 6 T 175 6 T 200 6"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default Squiggle;
