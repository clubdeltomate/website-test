import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import SketchButton from './SketchButton';

export interface EmptyStateProps {
  /** One of the /empty-*.svg assets */
  image: string;
  imageAlt?: string;
  headline?: string;
  explainer?: string;
  ctaLabel?: string;
  onCta?: () => void;
  className?: string;
  children?: ReactNode;
}

/** Centered doodle illustration + Caveat headline + explainer + accent CTA (design.md §7.9) */
export default function EmptyState({
  image,
  imageAlt = '',
  headline = "Nothing here yet — let's sketch something!",
  explainer,
  ctaLabel,
  onCta,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <img src={image} alt={imageAlt} className="w-56 max-w-full" />
      <h2 className="font-display text-3xl text-ink">{headline}</h2>
      {explainer && <p className="max-w-sm text-sm text-ink-soft">{explainer}</p>}
      {ctaLabel && (
        <SketchButton variant="accent" className="mt-2" onClick={onCta}>
          {ctaLabel}
        </SketchButton>
      )}
      {children}
    </div>
  );
}
