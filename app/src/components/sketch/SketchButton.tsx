import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-paper-3 border-2 border-ink hover:bg-[#3d352b]',
  accent: 'bg-yellow text-ink border-2 border-ink hover:bg-[#ffd05c]',
  secondary: 'bg-paper-3 text-ink border-2 border-ink hover:bg-paper-2',
  danger: 'bg-red text-paper-3 border-2 border-ink hover:bg-[#e4675b]',
  ghost:
    'bg-transparent text-ink border-2 border-transparent hover:border-dashed hover:border-ink',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-base gap-2',
  lg: 'px-6 py-3 text-lg gap-2',
  icon: 'h-10 w-10 p-0 justify-center',
};

export interface SketchButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: ReactNode;
}

/** Hand-drawn pencil spinner used in loading state */
function PencilSpinner() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 animate-spin"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 2a8 8 0 1 1-7.4 5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="3 4"
      />
      <path d="M10 2l1.8 3.4L8.4 4z" fill="currentColor" />
    </svg>
  );
}

export default function SketchButton({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: SketchButtonProps) {
  const locked = disabled || loading;
  return (
    <button
      disabled={locked}
      className={cn(
        'inline-flex items-center rounded-wobble-sm font-heading font-semibold shadow-offset',
        'transition-all duration-150 ease-out select-none',
        'active:translate-x-[2px] active:translate-y-[2px] active:shadow-offset-pressed',
        VARIANTS[variant],
        SIZES[size],
        locked &&
          'opacity-60 cursor-not-allowed shadow-none active:translate-x-0 active:translate-y-0',
        className,
      )}
      {...rest}
    >
      {loading ? <PencilSpinner /> : children}
    </button>
  );
}
