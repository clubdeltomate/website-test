import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import DeckPlayer from '@/components/player/DeckPlayer';
import SketchButton from '@/components/sketch/SketchButton';
import { ChevronLeft } from 'lucide-react';

/**
 * Watch a saved PRESET presentation — the deck the owner generated once, so a
 * viewer scrolls through it without triggering (or paying for) a new
 * generation. Commercial items end on the contact/order screen.
 */
export default function PresetPlay() {
  const { slug = '', seq = '' } = useParams();
  const navigate = useNavigate();
  const lessonSeq = Number(seq);
  const query = trpc.repos.lessonPreset.useQuery(
    { repoSlug: slug, lessonSeq },
    { enabled: !!slug && Number.isFinite(lessonSeq), retry: 1 },
  );

  const back = () => navigate(`/repos/${slug}`);

  // admin length-calibration persists back onto the saved lesson preset
  const utils = trpc.useUtils();
  const setPreset = trpc.repos.setLessonPreset.useMutation({
    onSuccess: () => {
      toast.success('Saved to the preset ✓');
      void utils.repos.lessonPreset.invalidate({ repoSlug: slug, lessonSeq });
    },
    onError: (e) => toast.error(e.message),
  });

  if (query.isLoading) {
    return <div className="mx-auto max-w-[720px] px-4 py-16 text-center text-ink-faint">Opening…</div>;
  }
  if (query.isError) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 text-center">
        <p className="font-display text-3xl text-ink">The presentation didn't load</p>
        <p className="mt-2 text-ink-soft">Usually a hiccup — try again, or go back and reopen it.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <SketchButton variant="accent" onClick={() => void query.refetch()}>
            Try again
          </SketchButton>
          <SketchButton variant="secondary" onClick={back}>
            <ChevronLeft className="h-4 w-4" /> Back
          </SketchButton>
        </div>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 text-center">
        <p className="font-display text-3xl text-ink">Nothing to show yet</p>
        <p className="mt-2 text-ink-soft">
          This item doesn't have a saved presentation, or it isn't available.
        </p>
        <SketchButton variant="secondary" className="mt-4" onClick={back}>
          <ChevronLeft className="h-4 w-4" /> Back
        </SketchButton>
      </div>
    );
  }

  const { deck, seed, toolSlug, commercial, walkthrough } = query.data;

  return (
    <DeckPlayer
      deck={deck}
      toolSlug={toolSlug}
      seed={seed}
      previouslyTaught={null}
      voiceURI={null}
      nextLessonTitle={null}
      commercial={commercial}
      walkthrough={walkthrough}
      onPersistDeck={(d) => setPreset.mutate({ repoSlug: slug, lessonSeq, deck: d })}
      onExit={back}
    />
  );
}
