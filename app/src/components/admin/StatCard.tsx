import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import SketchCard from '@/components/sketch/SketchCard';
import CountUp from './CountUp';

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  index?: number;
  /** e.g. '+12%' — renders a hand-drawn caret */
  delta?: string;
  deltaUp?: boolean;
  /** accent color for the icon circle */
  tone?: 'yellow' | 'orange' | 'purple' | 'blue' | 'green';
  className?: string;
}

const TONES: Record<NonNullable<StatCardProps['tone']>, string> = {
  yellow: 'bg-yellow-soft',
  orange: 'bg-orange/20',
  purple: 'bg-purple-soft',
  blue: 'bg-blue-soft',
  green: 'bg-green-soft',
};

/** Stat card: doodle icon, micro label, big Caveat count-up (design.md §7.3) */
export default function StatCard({
  icon: Icon,
  label,
  value,
  index = 0,
  delta,
  deltaUp,
  tone = 'yellow',
  className,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
    >
      <SketchCard index={index} className={cn('flex items-center gap-4 p-4', className)}>
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-ink',
            TONES[tone],
          )}
        >
          <Icon className="h-5 w-5 text-ink" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-4xl font-bold leading-none text-ink">
            <CountUp value={value} />
          </span>
          <span className="micro mt-1 block truncate text-ink-soft">{label}</span>
          {delta && (
            <span
              className={cn(
                'mt-0.5 inline-flex items-center gap-1 text-xs font-bold',
                deltaUp ? 'text-green' : 'text-red',
              )}
            >
              <svg
                viewBox="0 0 10 10"
                className={cn('h-2.5 w-2.5', !deltaUp && 'rotate-180')}
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1.5 7C3.2 5 4.4 3.4 4.8 2c.5 1.3 1.7 3.2 3.7 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              {delta}
            </span>
          )}
        </span>
      </SketchCard>
    </motion.div>
  );
}
