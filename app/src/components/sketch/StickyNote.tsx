import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface StickyNoteProps extends HTMLAttributes<HTMLDivElement> {
  /** Rotation in degrees; default -1.5 per design.md §5.4 */
  rotate?: number;
  children: ReactNode;
}

/** Yellow sticky note with wobble-2 radius and a curled corner (design.md §5.4) */
export default function StickyNote({
  rotate = -1.5,
  className,
  children,
  style,
  ...rest
}: StickyNoteProps) {
  return (
    <div
      className={cn(
        'relative bg-yellow text-ink rounded-wobble-2 p-4 pt-5 shadow-offset',
        'font-heading text-[1.05rem] leading-snug',
        className,
      )}
      style={{ transform: `rotate(${rotate}deg)`, ...style }}
      {...rest}
    >
      {/* curled corner */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 right-0 h-0 w-0 border-solid"
        style={{
          borderWidth: '0 0 18px 18px',
          borderColor: 'transparent transparent rgba(46,40,32,.18) transparent',
          borderBottomRightRadius: '14px',
        }}
      />
      {children}
    </div>
  );
}
