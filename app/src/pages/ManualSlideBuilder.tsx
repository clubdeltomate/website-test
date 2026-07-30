import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import DeckBuilder, { blankDeck } from '@/components/slides/DeckBuilder';
import type { SlideDeck } from '@contracts/types';

/**
 * Build a standalone hand-made presentation on the Slides page — start from
 * zero (no AI), using the same editor as the repo preset builder. New at
 * /slides/build; edit an existing human tool at /slides/build/:slug.
 */
export default function ManualSlideBuilder() {
  const { slug } = useParams();
  const editing = !!slug;
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const utils = trpc.useUtils();

  const deckQ = trpc.slideTools.deck.useQuery({ slug: slug! }, { enabled: editing });
  const [name, setName] = useState('');
  const [deck, setDeck] = useState<SlideDeck | null>(editing ? null : blankDeck(''));

  useEffect(() => {
    if (editing && deckQ.data && !deck) {
      setDeck(deckQ.data.deck);
      setName(deckQ.data.name);
    }
  }, [editing, deckQ.data, deck]);

  // The new card's banner draws itself in the background — quiet on failure,
  // the card keeps its Draw button as the fallback.
  const autoBanner = trpc.slideTools.generateBanner.useMutation({
    onSuccess: () => void utils.slideTools.list.invalidate(),
    onError: () => undefined,
  });
  const create = trpc.slideTools.createManual.useMutation({
    onSuccess: (r) => {
      toast.success('Presentation published ✓');
      autoBanner.mutate({ slug: r.slug, onlyIfMissing: true });
      void utils.slideTools.list.invalidate();
      navigate('/slides');
    },
    onError: (e) => toast.error(e.message),
  });
  const saveDeck = trpc.slideTools.saveDeck.useMutation({
    onSuccess: () => {
      toast.success('Presentation saved ✓');
      void utils.slideTools.list.invalidate();
      void utils.slideTools.deck.invalidate({ slug: slug! });
      navigate('/slides');
    },
    onError: (e) => toast.error(e.message),
  });
  const saving = create.isPending || saveDeck.isPending;

  if (isGuest) {
    return (
      <div className="mx-auto max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">Sign in to build a presentation.</p>
        <Link to="/auth" className="mt-3 inline-block font-heading font-bold text-blue underline">
          Sign in
        </Link>
      </div>
    );
  }
  if (editing && deckQ.isLoading) {
    return <div className="mx-auto max-w-content px-4 py-10 text-center text-ink-faint">Loading…</div>;
  }
  if (editing && deckQ.isSuccess && !deckQ.data) {
    return (
      <div className="mx-auto max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">This isn't a hand-built presentation.</p>
        <Link to="/slides" className="mt-3 inline-block font-heading font-bold text-blue underline">
          Back to Slides
        </Link>
      </div>
    );
  }
  if (!deck) {
    return <div className="mx-auto max-w-content px-4 py-10 text-center text-ink-faint">Preparing…</div>;
  }

  const doSave = () => {
    if (editing) {
      saveDeck.mutate({ slug: slug!, deck });
      return;
    }
    if (name.trim().length < 3) {
      toast.error('Give your presentation a name (at least 3 characters)');
      return;
    }
    create.mutate({ name: name.trim(), deck });
  };

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/slides"
          className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Slides
        </Link>
        <h2 className="font-display text-3xl font-bold text-ink">
          {editing ? 'Edit presentation' : 'New manual presentation'}
        </h2>
        <span className="micro rounded-full border-2 border-ink bg-green-soft px-2 text-[0.6rem] font-bold text-green">
          human-made
        </span>
        <SketchButton
          variant="accent"
          size="sm"
          className="ml-auto"
          loading={saving}
          onClick={doSave}
        >
          <Save className="h-4 w-4" /> {editing ? 'Save' : 'Publish'}
        </SketchButton>
      </div>

      {!editing && (
        <div>
          <span className="micro mb-1 block text-[0.6rem] uppercase tracking-wider text-ink-faint">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Espresso Menu"
            className={cn(
              'w-full rounded-wobble-sm border-2 border-ink bg-paper px-3 py-2 font-heading text-lg font-bold text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue',
            )}
          />
        </div>
      )}
      <p className="-mt-1 text-sm text-ink-soft">
        Build the slides by hand — text, images, tables and a multiple-choice question. No AI is used,
        so it's free for anyone to play once you publish.
      </p>

      <DeckBuilder deck={deck} onChange={setDeck} />

      <div className="flex justify-end">
        <SketchButton variant="accent" loading={saving} onClick={doSave}>
          <Save className="h-4 w-4" /> {editing ? 'Save' : 'Publish'}
        </SketchButton>
      </div>
    </div>
  );
}
