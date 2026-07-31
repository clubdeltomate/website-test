import { useCallback, useMemo, useState } from 'react';
import { Coins } from 'lucide-react';
import { SketchModal } from '@/components/admin/overlays';
import SketchButton from '@/components/sketch/SketchButton';
import { useAuth } from '@/hooks/useAuth';
import { type CostConfirm, CostConfirmContext } from './cost-confirm';
import { say } from '@/lib/i18n';

/* Ask before spending.
 *
 * Every AI action in the marketing tool costs credits. The buttons quote the
 * price, but they used to spend it on the first click. This puts one dialog in
 * front of all of them — what it does, what it costs, what is left afterwards
 * — with a way to switch the asking off for someone who already knows.
 *
 * The charge itself is unchanged and unconditional: applyTokenDelta debits
 * every account the same way, so an admin pays exactly what a new user pays.
 * All this decides is whether you are asked first. */

const SKIP_KEY = 'sketchlearn.costConfirm.skip';

const readSkip = () => {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false; // private mode, or storage disabled — just keep asking
  }
};

const writeSkip = (on: boolean) => {
  try {
    if (on) localStorage.setItem(SKIP_KEY, '1');
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    /* nothing to do — the dialog simply keeps appearing */
  }
};

interface Pending {
  what: string;
  cost: number;
  resolve: (go: boolean) => void;
}

/** Wraps a page so anything inside can await confirmation before it spends. */
export default function CostConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [muted, setMutedState] = useState(readSkip);
  const { user } = useAuth();
  const balance = user?.tokenBalance;

  const ask = useCallback<CostConfirm['ask']>(
    (what, cost) => {
      // An unpriced action — the quote hasn't loaded — is not worth blocking on.
      if (muted || cost == null) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => setPending({ what, cost, resolve }));
    },
    [muted],
  );

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeSkip(next);
  }, []);

  const settle = (go: boolean, remember = false) => {
    if (remember) setMuted(true);
    pending?.resolve(go);
    setPending(null);
  };

  const value = useMemo(() => ({ ask, muted, setMuted }), [ask, muted, setMuted]);

  return (
    <CostConfirmContext.Provider value={value}>
      {children}
      <SketchModal
        open={pending !== null}
        onClose={() => settle(false)}
        title={say("This costs credits")}
        maxWidth="max-w-[430px]"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-yellow-soft">
              <Coins className="h-4 w-4 text-ink" strokeWidth={2} />
            </span>
            <div>
              <p className="text-[0.95rem] text-ink">
                {pending?.what}  {say("costs")} <span className="font-bold">{pending?.cost} 🪙</span>.
              </p>
              {balance != null && pending && (
                <p className="micro mt-1 text-[0.6rem] text-ink-soft">
                  
                  {say("You have")} {balance} 🪙 — {Math.max(0, balance - pending.cost)}  {say("left afterwards.")}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
            <SketchButton variant="accent" onClick={() => settle(true)}>
              
              {say("Yes, spend it")}
            </SketchButton>
            <SketchButton variant="secondary" onClick={() => settle(false)}>
              
              {say("Cancel")}
            </SketchButton>
            <button
              type="button"
              onClick={() => settle(true, true)}
              className="micro ml-auto rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
            >
              
              {say("Don't remind me")}
            </button>
          </div>
        </div>
      </SketchModal>
    </CostConfirmContext.Provider>
  );
}
