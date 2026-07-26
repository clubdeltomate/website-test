import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface WashiTapeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: 'yellow' | 'blue';
  /** Rotation in degrees, -4 to 3 reads most natural (design.md §5.3) */
  rotate?: number;
}

/** Semi-transparent washi tape strip; absolutely positioned over the top edge of a parent (make parent `relative`) */
export default function WashiTape({
  color = 'yellow',
  rotate = -3,
  className,
  style,
  ...rest
}: WashiTapeProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute -top-3 left-6 h-7 w-24 z-10',
        color === 'yellow' ? 'bg-yellow/60' : 'bg-blue-soft/70',
        className,
      )}
      style={{
        transform: `rotate(${rotate}deg)`,
        boxShadow: 'inset 0 1px 2px rgba(46,40,32,.18)',
        clipPath:
          'polygon(2% 8%, 98% 0%, 100% 88%, 96% 100%, 4% 96%, 0% 12%)',
        ...style,
      }}
      {...rest}
    />
  );
}
