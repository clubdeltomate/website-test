import { Toaster } from 'sonner';

/**
 * Sticky-note styled toast stack (design.md §7.7): bottom-right, paper-3 cards
 * with ink borders. Mounted per-page (no global mount exists in the shell).
 */
export default function SketchToaster() {
  return (
    <Toaster
      position="bottom-right"
      gap={10}
      toastOptions={{
        style: {
          background: '#FFFDF6',
          color: '#2E2820',
          border: '2px solid #2E2820',
          borderRadius: '12px 6px 14px 6px / 6px 14px 6px 12px',
          boxShadow: '4px 4px 0 rgba(46,40,32,.14)',
          fontFamily: 'Nunito, sans-serif',
          fontWeight: 700,
        },
      }}
    />
  );
}
