import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Clapperboard, MonitorPlay, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import Chip from '@/components/sketch/Chip';
import type { RepoUnit } from '@contracts/types';
import { say } from '@/lib/i18n';

export interface SavedPresentationsTableProps {
  slug: string;
  /** owner / admin — gets the edit + delete controls */
  canEdit: boolean;
  units: RepoUnit[];
}

/**
 * The set / saved presentations for this repo: every lesson whose owner has
 * published a preset. These are the decks any user — even one with no credits —
 * can play for free. Owners/admins also get inline edit + delete here.
 */
export default function SavedPresentationsTable({
  slug,
  canEdit,
  units,
}: SavedPresentationsTableProps) {
  const utils = trpc.useUtils();
  const playLabel = 'Play';
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const del = trpc.repos.deleteLessonPreset.useMutation({
    onSuccess: () => {
      toast.success(say("Preset deleted"));
      void utils.repos.getBySlug.invalidate({ slug });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const rows = useMemo(
    () =>
      units.flatMap((u) =>
        u.lessons
          .filter((l) => l.hasPreset)
          .map((l) => ({ unitTitle: u.title, lesson: l })),
      ),
    [units],
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-2xl font-bold text-ink">{say("Saved presentations")}</h2>
        {rows.length > 0 && (
          <Chip kind="neutral" className="font-mono">
            {rows.length}
          </Chip>
        )}
        <span className="micro text-ink-faint">{say("free to play — no credits needed")}</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-2/40 px-4 py-10 text-center">
          <MonitorPlay className="mx-auto h-8 w-8 text-ink-faint" />
          <p className="mt-2 font-display text-xl text-ink-soft">{say("No presentations set yet")}</p>
          <p className="mt-1 text-sm text-ink-faint">
            {canEdit
              ? 'Press a Set button above to generate and publish a free presentation.'
              : 'The owner has not published any free presentations here yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-yellow">
                <th className="micro border-b-2 border-ink px-4 py-2 text-ink">{say("Unit")}</th>
                <th className="micro border-b-2 border-ink px-4 py-2 text-ink">{say("Presentation")}</th>
                <th className="micro border-b-2 border-ink px-4 py-2 text-center text-ink">{say("Order")}</th>
                <th className="micro border-b-2 border-ink px-4 py-2 text-right text-ink">{say("Access")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ unitTitle, lesson }) => {
                const playHref = `/repos/${slug}/play/${lesson.globalSeq}`;
                const editHref = `${playHref}/edit`;
                const confirming = pendingDelete === lesson.id;
                return (
                  <tr
                    key={lesson.id}
                    className="border-t-2 border-dashed border-pencil first:border-t-0 hover:bg-paper-2/60"
                  >
                    <td className="px-4 py-2.5 text-ink-soft">{unitTitle}</td>
                    <td className="px-4 py-2.5 font-heading font-semibold text-ink">{lesson.title}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-ink-soft">
                      {lesson.globalSeq}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link to={playHref} className="no-underline">
                          <span className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-yellow px-3 py-1.5 font-heading text-sm font-bold text-ink shadow-offset transition-transform hover:-translate-y-0.5">
                            <Clapperboard className="h-4 w-4" strokeWidth={2} /> {playLabel}
                          </span>
                        </Link>
                        {canEdit && (
                          <>
                            <Link to={editHref} title={say("Edit this preset")} className="no-underline">
                              <button
                                type="button"
                                className="rounded-wobble-sm border-2 border-pencil p-1.5 text-ink-soft transition-colors hover:border-ink hover:text-ink"
                                aria-label={say("Edit preset")}
                              >
                                <Pencil className="h-4 w-4" strokeWidth={2} />
                              </button>
                            </Link>
                            {confirming ? (
                              <span className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    del.mutate({ repoSlug: slug, lessonSeq: lesson.globalSeq })
                                  }
                                  disabled={del.isPending}
                                  className="rounded-wobble-sm border-2 border-red bg-red-soft px-2 py-1 text-xs font-bold text-red"
                                >
                                  
                                  {say("delete")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDelete(null)}
                                  className="rounded-wobble-sm px-1.5 py-1 text-xs text-ink-faint hover:text-ink"
                                >
                                  
                                  {say("cancel")}
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPendingDelete(lesson.id)}
                                title={say("Delete this preset")}
                                aria-label={say("Delete preset")}
                                className="rounded-wobble-sm border-2 border-transparent p-1.5 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={2} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
