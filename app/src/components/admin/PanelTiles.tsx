import { Link } from 'react-router';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import SketchCard from '@/components/sketch/SketchCard';

/* Launcher tiles shared by the admin hubs (Home, Controls, Projects). */

export const TILE_TONES = {
  yellow: 'bg-yellow-soft',
  orange: 'bg-orange/20',
  purple: 'bg-purple-soft',
  blue: 'bg-blue-soft',
  green: 'bg-green-soft',
  red: 'bg-red/15',
} as const;

export interface PanelTile {
  to: string;
  icon: LucideIcon;
  tone: keyof typeof TILE_TONES;
  title: string;
  blurb: string;
  /** show a count badge (only rendered when defined) */
  count?: number;
  /** highlight the badge when the count needs attention */
  urgent?: boolean;
  adminOnly?: boolean;
}

export function PanelTileCard({ tile, index }: { tile: PanelTile; index: number }) {
  const Icon = tile.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to={tile.to} className="group block no-underline">
        <SketchCard
          index={index}
          className="flex h-full items-center gap-4 p-4 transition-transform duration-150 group-hover:-translate-y-1"
        >
          <span
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-ink',
              TILE_TONES[tile.tone],
            )}
          >
            <Icon className="h-5 w-5 text-ink" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-heading text-lg font-semibold text-ink">
                {tile.title}
              </span>
              {tile.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full border-2 border-ink px-2 font-mono text-xs font-bold',
                    tile.urgent && tile.count > 0 ? 'bg-orange text-ink' : 'bg-paper-3 text-ink',
                  )}
                >
                  {tile.count}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink-soft">{tile.blurb}</span>
          </span>
          <ArrowRight
            className="h-5 w-5 shrink-0 text-ink-faint transition-all duration-150 group-hover:translate-x-1 group-hover:text-ink"
            strokeWidth={2.5}
          />
        </SketchCard>
      </Link>
    </motion.div>
  );
}

/** Standard hub-page header: back link + display title + one-line blurb. */
export function HubHeader({
  backTo,
  backLabel,
  title,
  blurb,
  chip,
}: {
  backTo?: string;
  backLabel?: string;
  title: string;
  blurb?: string;
  chip?: React.ReactNode;
}) {
  return (
    <div>
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 font-heading text-sm font-semibold text-blue no-underline hover:underline"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
            <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backLabel ?? 'Back'}
        </Link>
      )}
      <h2 className="mt-1 flex flex-wrap items-center gap-3 font-display text-4xl font-bold text-ink">
        {title}
        {chip}
      </h2>
      {blurb && <p className="text-sm text-ink-soft">{blurb}</p>}
    </div>
  );
}
