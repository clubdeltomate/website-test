import { Link } from 'react-router';
import { ArrowLeft, UserRound } from 'lucide-react';
import SketchButton from '../sketch/SketchButton';
import { say } from '@/lib/i18n';

/**
 * The closing actions every deck ends on, whatever it was: one big "Back to
 * browsing" button, and a quiet underlined link to whoever made it.
 *
 * It lives in one place because the three finish screens had drifted — the
 * walkthrough/news ending made the profile the big accent button and demoted
 * leaving to a secondary "Back", the opposite arrangement to the showcase and
 * lesson endings. Reaching the end of a deck should look the same regardless
 * of which kind it was.
 */
export function EndingActions({
  ownerId,
  ownerName,
  onExit,
  exitLabel = 'Back to browsing',
}: {
  ownerId?: number | null;
  ownerName?: string | null;
  onExit: () => void;
  /** override only when "browsing" is the wrong word for where Back goes */
  exitLabel?: string;
}) {
  return (
    <>
      <div className="mt-7">
        <SketchButton variant="accent" className="w-full justify-center" onClick={onExit}>
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          {exitLabel}
        </SketchButton>
      </div>
      <div className="mt-4 flex flex-col items-center gap-2.5">
        <AuthorProfileLink ownerId={ownerId} ownerName={ownerName} />
      </div>
    </>
  );
}

/** The quiet profile link on its own, for endings that build their own row. */
export function AuthorProfileLink({
  ownerId,
  ownerName,
}: {
  ownerId?: number | null;
  ownerName?: string | null;
}) {
  if (ownerId == null) return null;
  return (
    <Link
      to={`/users/${ownerId}`}
      className="inline-flex items-center gap-1.5 font-heading text-sm font-semibold text-ink-soft underline underline-offset-4 transition-colors hover:text-ink"
    >
      <UserRound className="h-4 w-4" strokeWidth={2} />
      
      {say("Visit")} {ownerName ? `${ownerName}'s` : 'the author’s'}  {say("profile")}
    </Link>
  );
}
