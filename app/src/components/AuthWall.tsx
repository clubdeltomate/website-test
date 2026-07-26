import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import SketchButton from './sketch/SketchButton';
import WashiTape from './sketch/WashiTape';

export interface AuthWallProps {
  open: boolean;
  onClose: () => void;
  message?: string;
}

/** Doodle padlock for the role-gate upsell (design.md §7.12) */
function PadlockDoodle() {
  return (
    <svg viewBox="0 0 72 72" className="h-16 w-16" fill="none" aria-hidden="true">
      <path
        d="M22 32v-8a14 14 0 0 1 28 0v8"
        stroke="#2E2820"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect x="16" y="30" width="40" height="32" rx="8" fill="#FFC53D" stroke="#2E2820" strokeWidth="4" />
      <circle cx="36" cy="44" r="4.5" fill="#2E2820" />
      <path d="M36 47v7" stroke="#2E2820" strokeWidth="4" strokeLinecap="round" />
      <path d="M60 12l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z" fill="#8566D4" />
    </svg>
  );
}

/**
 * Role-gate upsell modal (design.md §7.12): shown when a guest hits a signed-in feature.
 * Sign in / Create account both link to /auth (custom email/password auth — backend pass).
 */
export default function AuthWall({ open, onClose, message }: AuthWallProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
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
            aria-label="Sign in required"
            className="relative w-full max-w-[560px] rounded-wobble-2 border-2 border-ink bg-paper-3 p-8 pt-10 text-center shadow-offset"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <WashiTape rotate={-4} className="left-8" />
            <WashiTape rotate={3} color="blue" className="left-auto right-8" />
            <div className="flex justify-center">
              <PadlockDoodle />
            </div>
            <h2 className="mt-3 font-display text-4xl text-ink">
              This page lives in a signed-in notebook
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
              {message ??
                'Sign in (it takes ten seconds) to create repositories, generate slides, and keep everything you sketch.'}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link to="/auth">
                <SketchButton variant="accent">Sign in</SketchButton>
              </Link>
              <Link to="/auth">
                <SketchButton variant="secondary">Create account</SketchButton>
              </Link>
            </div>
            <button
              onClick={onClose}
              className="micro mt-5 text-ink-faint hover:text-ink"
            >
              keep browsing as guest
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
