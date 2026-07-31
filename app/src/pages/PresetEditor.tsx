import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import DeckBuilder, { blankDeck } from '@/components/slides/DeckBuilder';
import type { SlideDeck } from '@contracts/types';
import { say } from '@/lib/i18n';

/**
 * Editor for a lesson's preset deck. Owner / admin only. When the lesson has no
 * preset yet it opens as a blank MANUAL builder — add slides & blocks by hand
 * and save to publish a playable presentation without AI.
 */
export default function PresetEditor() {
  const { slug, seq } = useParams();
  const lessonSeq = Number(seq);
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const utils = trpc.useUtils();

  const repoQ = trpc.repos.getBySlug.useQuery({ slug: slug! }, { enabled: !!slug });
  const presetQ = trpc.repos.lessonPreset.useQuery(
    { repoSlug: slug!, lessonSeq },
    { enabled: !!slug && Number.isFinite(lessonSeq) },
  );

  const isOwner = !!repoQ.data && (repoQ.data.ownerId === user?.id || role === 'admin');
  const lessonTitle =
    repoQ.data?.units.flatMap((u) => u.lessons).find((l) => l.globalSeq === lessonSeq)?.title ?? '';
  const isNew = presetQ.isSuccess && !presetQ.data;

  const [deck, setDeck] = useState<SlideDeck | null>(null);
  useEffect(() => {
    if (deck) return;
    if (presetQ.data?.deck) setDeck(presetQ.data.deck);
    else if (presetQ.isSuccess && !presetQ.data && isOwner) setDeck(blankDeck(lessonTitle));
  }, [presetQ.data, presetQ.isSuccess, isOwner, deck, lessonTitle]);

  const save = trpc.repos.updateLessonPreset.useMutation({
    onSuccess: () => {
      toast.success(isNew ? 'Presentation published — now free to play ✓' : 'Preset updated ✓');
      void utils.repos.lessonPreset.invalidate({ repoSlug: slug!, lessonSeq });
      void utils.repos.getBySlug.invalidate({ slug: slug! });
      navigate(`/repos/${slug}`);
    },
    onError: (e) => toast.error(say(e.message)),
  });
  const del = trpc.repos.deleteLessonPreset.useMutation({
    onSuccess: () => {
      toast.success(say("Preset deleted"));
      void utils.repos.getBySlug.invalidate({ slug: slug! });
      navigate(`/repos/${slug}`);
    },
    onError: (e) => toast.error(say(e.message)),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (repoQ.isLoading || presetQ.isLoading) {
    return <div className="mx-auto max-w-content px-4 py-10 text-center text-ink-faint">{say("Loading…")}</div>;
  }
  if (!isOwner) {
    return (
      <div className="mx-auto max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">{say("Only the repo's owner or an admin can build this presentation.")}</p>
        <Link to={`/repos/${slug}`} className="mt-3 inline-block font-heading font-bold text-blue underline">
          
          {say("Back to repo")}
        </Link>
      </div>
    );
  }
  if (!deck) {
    return <div className="mx-auto max-w-content px-4 py-10 text-center text-ink-faint">{say("Preparing the builder…")}</div>;
  }

  const doSave = () => save.mutate({ repoSlug: slug!, lessonSeq, deck });

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/repos/${slug}`}
          className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />  {say("Repo")}
        </Link>
        <h2 className="font-display text-3xl font-bold text-ink">
          {isNew ? 'Build presentation' : 'Edit preset'}
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {!isNew &&
            (confirmDelete ? (
              <>
                <span className="micro text-[0.7rem] font-bold text-red">{say("delete preset?")}</span>
                <SketchButton
                  variant="danger"
                  size="sm"
                  loading={del.isPending}
                  onClick={() => del.mutate({ repoSlug: slug!, lessonSeq })}
                >
                  <Trash2 className="h-4 w-4" />  {say("Delete")}
                </SketchButton>
                <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  
                  {say("Cancel")}
                </SketchButton>
              </>
            ) : (
              <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" />  {say("Delete")}
              </SketchButton>
            ))}
          <SketchButton variant="accent" size="sm" loading={save.isPending} onClick={doSave}>
            <Save className="h-4 w-4" /> {isNew ? 'Publish' : 'Save changes'}
          </SketchButton>
        </div>
      </div>
      <p className="-mt-2 text-sm text-ink-soft">
        {isNew
          ? 'Build the slides by hand — add text, images, tables and a multiple-choice question. No AI is used, so it stays free for anyone to play once you publish.'
          : 'Everything with a field is editable. Changes only affect the saved free preset — students who customize with a ticket still generate their own version.'}
      </p>

      <DeckBuilder deck={deck} onChange={setDeck} />

      <div className="flex justify-end">
        <SketchButton variant="accent" loading={save.isPending} onClick={doSave}>
          <Save className="h-4 w-4" /> {isNew ? 'Publish' : 'Save changes'}
        </SketchButton>
      </div>
    </div>
  );
}
