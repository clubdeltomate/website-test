import { useLocation, useNavigate, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import DeckPlayer from '@/components/player/DeckPlayer';
import SketchButton from '@/components/sketch/SketchButton';
import { say } from '@/lib/i18n';

/**
 * Play a slide tool's hand-built presentation (source = "human"). Plays the
 * saved deck directly — no generation, no charge.
 */
export default function ManualSlidePlay() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const query = trpc.slideTools.deck.useQuery({ slug }, { enabled: !!slug, retry: 1 });
  const location = useLocation();
  // Leave to wherever the viewer came from — Slides, a repo, the gallery.
  // Only a direct link (no in-app history) falls back to the Slides page.
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/slides'));

  // admin length-calibration persists back onto the tool's saved deck
  const utils = trpc.useUtils();
  const saveDeck = trpc.slideTools.saveDeck.useMutation({
    onSuccess: () => {
      toast.success(say("Saved ✓"));
      void utils.slideTools.deck.invalidate({ slug });
    },
    onError: (e) => toast.error(say(e.message)),
  });

  if (query.isLoading) {
    return <div className="mx-auto max-w-[720px] px-4 py-16 text-center text-ink-faint">{say("Opening…")}</div>;
  }
  if (query.isError) {
    // transient load failure — offer a retry and the road back to settings
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 text-center">
        <p className="font-display text-3xl text-ink">{say("The presentation didn't load")}</p>
        <p className="mt-2 text-ink-soft">
          
          {say("Usually a hiccup — try again, or head back to the tool's settings and reopen it from there.")}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <SketchButton variant="accent" onClick={() => void query.refetch()}>
            
            {say("Try again")}
          </SketchButton>
          <SketchButton variant="secondary" onClick={() => navigate(`/slides/${slug}`)}>
            <ChevronLeft className="h-4 w-4" />  {say("Tool settings")}
          </SketchButton>
        </div>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 text-center">
        <p className="font-display text-3xl text-ink">{say("Nothing to show")}</p>
        <p className="mt-2 text-ink-soft">{say("This tool doesn't have a hand-built presentation.")}</p>
        <SketchButton variant="secondary" className="mt-4" onClick={back}>
          <ChevronLeft className="h-4 w-4" />  {say("Back")}
        </SketchButton>
      </div>
    );
  }

  return (
    <DeckPlayer
      deck={query.data.deck}
      toolSlug={slug}
      seed={null}
      previouslyTaught={null}
      voiceURI={null}
      nextLessonTitle={null}
      commercial={query.data.commercial}
      walkthrough={query.data.walkthrough}
      onPersistDeck={(d) => saveDeck.mutate({ slug, deck: d })}
      onExit={back}
    />
  );
}
