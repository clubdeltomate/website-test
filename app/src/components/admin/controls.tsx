import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Shared form controls in the sketch system (design.md §7.4, §7.10)   */
/* ------------------------------------------------------------------ */

export function fieldCls(bad?: boolean): string {
  return cn(
    'w-full rounded-wobble-sm border-2 bg-paper-3 px-3.5 py-2.5 font-body text-ink placeholder:text-ink-faint',
    'transition-shadow focus:outline-none',
    bad
      ? 'border-red focus:border-red focus:shadow-[4px_4px_0_#FADFDB]'
      : 'border-ink focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB]',
  );
}

export interface LabeledFieldProps {
  label: string;
  helper?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

/** Label (micro uppercase) + control + helper/error with squiggle (design.md §7.4) */
export function LabeledField({ label, helper, error, children, className }: LabeledFieldProps) {
  return (
    <div className={className}>
      <span className="micro mb-1 block text-ink-soft">{label}</span>
      {children}
      {error ? (
        <span className="squiggle-red mt-1 block text-sm font-bold text-red">{error}</span>
      ) : helper ? (
        <span className="mt-1 block text-xs text-ink-faint">{helper}</span>
      ) : null}
    </div>
  );
}

export function SketchInput(props: InputHTMLAttributes<HTMLInputElement> & { bad?: boolean }) {
  const { bad, className, ...rest } = props;
  return <input className={cn(fieldCls(bad), className)} {...rest} />;
}

export function SketchTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { bad?: boolean }) {
  const { bad, className, ...rest } = props;
  return <textarea className={cn(fieldCls(bad), 'min-h-[88px]', className)} {...rest} />;
}

export function SketchSelect(props: SelectHTMLAttributes<HTMLSelectElement> & { bad?: boolean }) {
  const { bad, className, ...rest } = props;
  return (
    <select
      className={cn(fieldCls(bad), 'cursor-pointer appearance-none pr-8', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5c2 2 3.6 3.8 5 5 1.4-1.2 3-3 5-5' stroke='%232E2820' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
      }}
      {...rest}
    />
  );
}

export interface SketchToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  danger?: boolean;
}

/** Hand-drawn switch — knob slides with spring (design.md §7.4) */
export function SketchToggle({ checked, onChange, label, disabled, danger }: SketchToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border-2 border-ink transition-colors duration-200',
        checked ? (danger ? 'bg-red' : 'bg-green') : 'bg-paper-2',
        disabled && 'cursor-not-allowed opacity-50',
        !disabled && 'cursor-pointer',
      )}
    >
      <motion.span
        className="absolute top-0.5 h-5 w-5 rounded-full border-2 border-ink bg-paper-3 shadow-[1px_1px_0_rgba(46,40,32,.25)]"
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      />
    </button>
  );
}

export interface TabDef {
  id: string;
  label: ReactNode;
}

/** Tab bar with animated marker-stroke underline (design.md §7.10); scrolls on mobile */
export function SketchTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex gap-1 overflow-x-auto border-b-2 border-dashed border-pencil pb-0',
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'micro relative whitespace-nowrap px-3 py-2.5 transition-colors',
              isActive ? 'text-ink' : 'text-ink-faint hover:text-ink-soft',
            )}
          >
            {tab.label}
            {isActive && (
              <motion.span
                layoutId={undefined}
                className="absolute bottom-0 left-1 right-1 h-[3px] rounded-full bg-yellow"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ transformOrigin: 'left' }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Small pencil-stroke skeleton block with a playful status line */
export function SkeletonBlock({ lines = 3, status }: { lines?: number; status?: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 py-4">
      {status && <p className="font-heading text-ink-faint">{status}</p>}
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-stroke h-10"
          style={{ width: `${92 - i * 14}%` }}
        />
      ))}
    </div>
  );
}
