import { Link } from 'react-router';
import Chip from '@/components/sketch/Chip';
import SketchTable from '@/components/sketch/SketchTable';
import type { SketchColumn } from '@/components/sketch/SketchTable';
import EmptyState from '@/components/sketch/EmptyState';
import { trpc } from '@/providers/trpc';
import type { LessonRunRow } from '@contracts/types';
import { ScoreBar, formatElapsed, relTime } from './shared';

export interface LessonRunsTableProps {
  slug: string;
  /** repo ref (without #) for the "view all runs" link */
  repoRef: string;
  /** lessonId → unit title, built from the repo detail */
  unitByLessonId: Map<number, string>;
}

/** Per-repo lesson runs table (repository.md §6) — yellow-header SketchTable */
export default function LessonRunsTable({ slug, repoRef, unitByLessonId }: LessonRunsTableProps) {
  const runs = trpc.repos.lessonRuns.useQuery({ slug, limit: 100 });
  const rows = runs.data ?? [];

  const columns: SketchColumn<LessonRunRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-base text-ink">
            {row.playerName.charAt(0).toUpperCase()}
          </span>
          <span className="font-heading font-semibold text-ink">{row.playerName}</span>
        </span>
      ),
      sortValue: (row) => row.playerName.toLowerCase(),
    },
    {
      key: 'played',
      header: 'Played',
      mono: true,
      render: (row) => relTime(row.completedAt),
      sortValue: (row) => new Date(row.completedAt).getTime(),
    },
    {
      key: 'unit',
      header: 'Unit',
      render: (row) =>
        row.lessonId != null ? (
          <span className="text-ink-soft">{unitByLessonId.get(row.lessonId) ?? '—'}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      key: 'lesson',
      header: 'Lesson',
      render: (row) =>
        row.lessonTitle ? (
          <span className="font-heading font-semibold text-ink">
            {row.lessonSeq != null && (
              <span className="mr-1 font-mono text-xs text-ink-faint">L{row.lessonSeq}</span>
            )}
            {row.lessonTitle}
          </span>
        ) : (
          <span className="text-ink-faint">free play</span>
        ),
      sortValue: (row) => row.lessonTitle ?? '',
    },
    {
      key: 'order',
      header: 'Course order',
      mono: true,
      render: (row) => (row.lessonSeq != null ? `#${row.lessonSeq}` : '—'),
      sortValue: (row) => row.lessonSeq ?? -1,
    },
    {
      key: 'level',
      header: 'Level',
      render: (row) => <Chip kind={row.level}>{row.level}</Chip>,
      sortValue: (row) => row.level,
    },
    {
      key: 'score',
      header: 'Score',
      render: (row) => <ScoreBar correct={row.scoreCorrect} total={row.scoreTotal} />,
      sortValue: (row) => (row.scoreTotal > 0 ? row.scoreCorrect / row.scoreTotal : 0),
    },
    {
      key: 'time',
      header: 'Time',
      mono: true,
      render: (row) => formatElapsed(row.elapsedSec),
      sortValue: (row) => row.elapsedSec,
    },
  ];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-2xl font-bold text-ink">Lesson runs</h2>
        {rows.length > 0 && (
          <Chip kind="neutral" className="font-mono">
            {rows.length}
          </Chip>
        )}
        <Link to={`/runs?repo=${repoRef}`} className="micro text-blue hover:squiggle">
          View all runs →
        </Link>
      </div>

      {runs.isLoading && (
        <div className="flex flex-col gap-2" aria-label="Loading lesson runs">
          <div className="skeleton-stroke h-9 w-full" />
          <div className="skeleton-stroke h-9 w-full" />
          <div className="skeleton-stroke h-9 w-4/5" />
          <p className="text-sm text-ink-faint">Grading the quizzes…</p>
        </div>
      )}

      {runs.isError && (
        <div className="rounded-wobble-sm border-2 border-dashed border-red bg-red-soft/60 px-4 py-3 text-sm text-ink">
          Couldn't load the runs for this notebook.{' '}
          <button
            type="button"
            className="squiggle-red font-bold text-red"
            onClick={() => void runs.refetch()}
          >
            Try again
          </button>
        </div>
      )}

      {runs.isSuccess && (
        <SketchTable
          columns={columns}
          rows={rows}
          rowKey={(row) => String(row.id)}
          emptyState={
            <EmptyState
              image="/empty-runs.svg"
              imageAlt="Empty runs clipboard doodle"
              headline="No completed plays yet"
              explainer="Runs save when a deck is finished — press a 🎬 Play button above to start the first one."
              className="py-8"
            />
          }
        />
      )}
    </section>
  );
}
