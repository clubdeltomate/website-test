import { createContext, useContext } from 'react';

/* The ask-before-spending contract, kept apart from the provider component so
 * each module exports one kind of thing and fast refresh stays happy. */

export interface CostConfirm {
  /** Resolves true to go ahead, false if they backed out. */
  ask: (what: string, cost: number | undefined) => Promise<boolean>;
  /** True while the reminder is switched off. */
  muted: boolean;
  setMuted: (muted: boolean) => void;
}

export const CostConfirmContext = createContext<CostConfirm | null>(null);

/** Outside a provider this lets every action straight through. */
export function useCostConfirm(): CostConfirm {
  return (
    useContext(CostConfirmContext) ?? {
      ask: () => Promise.resolve(true),
      muted: false,
      setMuted: () => {},
    }
  );
}
