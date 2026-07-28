import { motion } from 'framer-motion';
import { EndingActions } from './EndingActions';
import WashiTape from '../sketch/WashiTape';
import { DoodleSparkle } from '../sketch/DoodleIcons';
import type { WalkthroughInfo } from '@contracts/types';

/**
 * The end of a WALKTHROUGH (explanation) presentation: no score, no order —
 * the viewer is simply told they've reached the end and offered two ways on:
 * visit the author's profile, or go back to where they started (the slide
 * drawer, or the repo to continue the lesson flow). "Back" is handled by the
 * player's onExit, which already knows the origin.
 */
export default function WalkthroughFinish({
  walkthrough,
  onExit,
}: {
  walkthrough: WalkthroughInfo | null;
  onExit: () => void;
}) {
  const ownerName = walkthrough?.ownerName;
  const ownerId = walkthrough?.ownerId ?? null;
  const isNews = walkthrough?.kind === 'news';

  const heading = isNews ? "That's the briefing ✦" : "That's the walkthrough ✦";
  const body = walkthrough?.itemTitle
    ? isNews
      ? `You're caught up on ${walkthrough.itemTitle}.`
      : `You've been walked through ${walkthrough.itemTitle}.`
    : isNews
      ? "You're all caught up."
      : "You've reached the end — hope it made things clearer.";

  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-14 text-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-wobble-2 border-2 border-ink bg-paper-3 p-7 pt-9 shadow-offset"
      >
        <WashiTape rotate={-3} className="left-1/2 -translate-x-1/2" />
        <DoodleSparkle className="mx-auto h-9 w-9 text-purple" />
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">{heading}</h1>
        <p className="mt-2 text-ink-soft">
          {body}
          {ownerName ? ` ${isNews ? 'Reported' : 'Put together'} by ${ownerName}.` : ''}
        </p>

        <EndingActions ownerId={ownerId} ownerName={ownerName} onExit={onExit} />
      </motion.div>
    </div>
  );
}
