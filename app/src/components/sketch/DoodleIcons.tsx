import { cn } from '@/lib/utils';

interface DoodleProps {
  className?: string;
}

/** Small hand-drawn SVG doodles for margins and accents (design.md §5.5) */

export function DoodleStar({ className }: DoodleProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-5 w-5', className)} fill="none" aria-hidden="true">
      <path
        d="M12 3l2 5.2L19.5 9l-4.2 3.6 1.4 5.4L12 14.8 7.3 18l1.4-5.4L4.5 9l5.5-.8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DoodleSparkle({ className }: DoodleProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-5 w-5', className)} fill="currentColor" aria-hidden="true">
      <path d="M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4z" />
    </svg>
  );
}

export function DoodleArrow({ className }: DoodleProps) {
  return (
    <svg viewBox="0 0 40 24" className={cn('h-6 w-10', className)} fill="none" aria-hidden="true">
      <path
        d="M2 18c10 2 20-2 26-10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M28 4l6 3-2 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DoodleSpiral({ className }: DoodleProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-6 w-6', className)} fill="none" aria-hidden="true">
      <path
        d="M16 16c0-3 4-3.4 4.6-.6.7 3.2-2.4 6.4-6 5.8C10 20.4 7.4 14.6 11 10c4-5.2 13-4 15.6 2.4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DoodlePaperclip({ className }: DoodleProps) {
  return (
    <svg viewBox="0 0 24 32" className={cn('h-6 w-5', className)} fill="none" aria-hidden="true">
      <path
        d="M7 10v14a5 5 0 0 0 10 0V8a3.4 3.4 0 0 0-6.8 0v13"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DoodleCheck({ className }: DoodleProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-5 w-5', className)} fill="none" aria-hidden="true">
      <path
        d="M4 13c2 2.4 3.6 4.4 4.6 6 1.4-4.4 5-9.4 11-13"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Scissors divider — dashed line with centered scissors ("cut here") (design.md §5.6) */
export function ScissorsDivider({ className }: DoodleProps) {
  return (
    <div className={cn('flex items-center gap-3 text-ink-faint', className)} aria-hidden="true">
      <span className="h-0 flex-1 border-t-2 border-dashed border-pencil" />
      <svg viewBox="0 0 28 24" className="h-5 w-6" fill="none">
        <circle cx="6" cy="7" r="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="6" cy="17" r="3" stroke="currentColor" strokeWidth="2" />
        <path d="M8.5 8.8L24 16M8.5 15.2L24 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="h-0 flex-1 border-t-2 border-dashed border-pencil" />
    </div>
  );
}
