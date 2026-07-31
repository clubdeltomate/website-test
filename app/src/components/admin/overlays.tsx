import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import WashiTape from '@/components/sketch/WashiTape';
import { say } from '@/lib/i18n';

export interface SketchModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string;
}

/** Sketch-styled modal (design.md §7.7): paper-3 card, washi tape, spring entrance */
export function SketchModal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-[560px]',
}: SketchModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative w-full rounded-wobble-2 border-2 border-ink bg-paper-3 p-6 pt-9 shadow-offset',
              maxWidth,
            )}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <WashiTape rotate={-4} className="left-8" />
            <WashiTape rotate={3} color="blue" className="left-auto right-8" />
            <button
              onClick={onClose}
              aria-label={say("Close")}
              className="absolute right-3 top-3 rounded-wobble-sm p-1.5 text-ink-soft hover:bg-paper-2 hover:text-ink"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
            {title && (
              <h3 className="mb-3 font-display text-3xl font-bold text-ink">
                {title}
              </h3>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface SketchDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** px width on desktop; full-height bottom sheet on mobile */
  width?: number;
}

/** Right-side drawer (design.md §7.7): 480px default, spring slide-in */
export function SketchDrawer({
  open,
  onClose,
  title,
  children,
  width = 480,
}: SketchDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'absolute bottom-0 right-0 top-0 flex w-full flex-col border-l-2 border-ink bg-paper-3 shadow-offset',
              'max-sm:top-16 max-sm:rounded-tl-wobble-2 max-sm:border-l-0 max-sm:border-t-2',
            )}
            style={{ maxWidth: width }}
            initial={{ x: width }}
            animate={{ x: 0 }}
            exit={{ x: width }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="relative flex items-center justify-between border-b-2 border-dashed border-pencil px-5 py-4">
              <WashiTape rotate={-3} className="left-6" />
              <h3 className="font-display text-3xl font-bold text-ink">
                {title}
              </h3>
              <button
                onClick={onClose}
                aria-label={say("Close")}
                className="rounded-wobble-sm p-1.5 text-ink-soft hover:bg-paper-2 hover:text-ink"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5" data-lenis-prevent>
              {children}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
