import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const WOBBLES = [
  'rounded-wobble-1',
  'rounded-wobble-2',
  'rounded-wobble-3',
  'rounded-wobble-4',
] as const;

const BORDERS = {
  solid: 'border-2 border-solid border-ink',
  dashed: 'border-2 border-dashed border-pencil',
  dotted: 'border-2 border-dotted border-pencil',
} as const;

export interface SketchCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Rotates the wobble radius by index so no two adjacent cards share a shape */
  index?: number;
  /** Border style communicates hierarchy: solid = interactive, dashed = container, dotted = nested */
  borderStyle?: keyof typeof BORDERS;
  hover?: boolean;
  children: ReactNode;
}

export default function SketchCard({
  index = 0,
  borderStyle = 'solid',
  hover = false,
  className,
  children,
  ...rest
}: SketchCardProps) {
  return (
    <div
      className={cn(
        'bg-paper-3 p-5 shadow-offset transition-all duration-150',
        WOBBLES[((index % 4) + 4) % 4],
        BORDERS[borderStyle],
        hover &&
          'hover:-translate-y-[3px] hover:-rotate-[0.4deg] hover:shadow-offset-hover cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
