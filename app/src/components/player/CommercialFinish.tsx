import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, MessageCircle, UserRound } from 'lucide-react';
import SketchButton from '../sketch/SketchButton';
import WashiTape from '../sketch/WashiTape';
import { DoodleSparkle } from '../sketch/DoodleIcons';
import type { CommercialInfo } from '@contracts/types';

/** Turn a phone-ish string into a wa.me link (digits only). */
function waLink(whatsapp: string): string | null {
  const digits = whatsapp.replace(/[^\d]/g, '');
  return digits.length >= 6 ? `https://wa.me/${digits}` : null;
}

/**
 * The end of a commercial (menu/service/shop/product) presentation. No score
 * and no in-app order form — just who's offering the item and how to reach
 * them. The main action is to go back to browsing; contacting the owner over
 * WhatsApp and visiting their profile are secondary links.
 */
export default function CommercialFinish({
  commercial,
  onExit,
}: {
  commercial: CommercialInfo;
  onExit: () => void;
}) {
  const { owner, itemTitle } = commercial;
  const wa = owner.whatsapp ? waLink(owner.whatsapp) : null;

  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-14 text-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-wobble-2 border-2 border-ink bg-paper-3 p-7 pt-9 shadow-offset"
      >
        <WashiTape rotate={-3} className="left-1/2 -translate-x-1/2" />
        <DoodleSparkle className="mx-auto h-8 w-8 text-purple" />
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">{itemTitle}</h1>
        <p className="mt-1 text-ink-soft">
          Offered by <span className="font-bold text-ink">{owner.name}</span>
        </p>
        {owner.contactNote && (
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-soft">{owner.contactNote}</p>
        )}

        {/* main action: back to browsing */}
        <div className="mt-7">
          <SketchButton variant="accent" className="w-full justify-center" onClick={onExit}>
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            Back to browsing
          </SketchButton>
        </div>

        {/* secondary, underlined: contact over WhatsApp + owner profile */}
        <div className="mt-4 flex flex-col items-center gap-2.5">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-heading text-sm font-semibold text-ink underline underline-offset-4 transition-colors hover:text-green"
            >
              <MessageCircle className="h-4 w-4" strokeWidth={2} />
              Contact {owner.name} through WhatsApp
            </a>
          )}
          {owner.ownerId != null && (
            <Link
              to={`/users/${owner.ownerId}`}
              className="inline-flex items-center gap-1.5 font-heading text-sm font-semibold text-ink-soft underline underline-offset-4 transition-colors hover:text-ink"
            >
              <UserRound className="h-4 w-4" strokeWidth={2} />
              Visit {owner.name}'s profile
            </Link>
          )}
          {!wa && owner.ownerId == null && (
            <p className="text-sm text-ink-faint">The seller hasn't added contact details yet.</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
