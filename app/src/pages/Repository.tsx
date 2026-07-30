import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import {
  Check,
  Clapperboard,
  Pencil,
  Plus,
  Presentation,
  Share2,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AuthWall from '@/components/AuthWall';
import Chip from '@/components/sketch/Chip';
import EmptyState from '@/components/sketch/EmptyState';
import SketchButton from '@/components/sketch/SketchButton';
import WashiTape from '@/components/sketch/WashiTape';
import { Squiggle } from '@/components/sketch/Squiggle';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import type { LessonSeed, RepoLesson } from '@contracts/types';
import CourseMemoryPanel from '@/components/repo/CourseMemoryPanel';
import RepoLeadsPanel from '@/components/repo/RepoLeadsPanel';
import RepoTicketsPanel from '@/components/repo/RepoTicketsPanel';
import { repoPurpose } from '@contracts/types';
import LessonRunsTable from '@/components/repo/LessonRunsTable';
import SavedPresentationsTable from '@/components/repo/SavedPresentationsTable';
import UnitCard from '@/components/repo/UnitCard';
import {
  SketchToaster,
  TEMPLATE_META,
  TemplateIcon,
  relTime,
  studyUrl,
} from '@/components/repo/shared';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export default function Repository() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { user, isGuest, role } = useAuth();
  const utils = trpc.useUtils();

  // refetchOnMount: 'always' so progress (completed / try-again, next-up) is
  // fresh every time the learner returns here after playing a lesson.
  const repo = trpc.repos.getBySlug.useQuery(
    { slug },
    { retry: false, refetchOnMount: 'always' },
  );
  // shares the react-query cache with LessonRunsTable (same key)
  const runs = trpc.repos.lessonRuns.useQuery(
    { slug, limit: 100 },
    { enabled: repo.isSuccess, refetchOnMount: 'always' },
  );

  const [authWallOpen, setAuthWallOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const data = repo.data ?? null;
  const canEdit = !!user && !!data && (data.ownerId === user.id || role === 'admin');
  const meta = TEMPLATE_META[data?.template ?? 'other'];

  /* ---------------- derived: flattened lessons, next-up -------------------- */
  const { flatLessons, nextUp, unitByLessonId, playedCount } = useMemo(() => {
    const flat: { lesson: RepoLesson; unitTitle: string }[] = [];
    const unitMap = new Map<number, string>();
    if (data) {
      for (const u of data.units) {
        for (const l of u.lessons) {
          flat.push({ lesson: l, unitTitle: u.title });
          unitMap.set(l.id, u.title);
        }
      }
      flat.sort((a, b) => a.lesson.globalSeq - b.lesson.globalSeq || a.lesson.orderIndex - b.lesson.orderIndex);
    }
    // Next up = the viewer's first lesson not yet PASSED — a failed lesson
    // stays "next up" (shown as try-again) until it is completed.
    const next = flat.find((f) => f.lesson.myStatus !== 'completed') ?? null;
    const played = flat.filter((f) => f.lesson.myStatus === 'completed').length;
    return { flatLessons: flat, nextUp: next, unitByLessonId: unitMap, playedCount: played };
  }, [data]);

  const nextUpUrl = useMemo(() => {
    if (!data?.studyToolSlug || !nextUp) return null;
    const seed: LessonSeed = {
      repoSlug: data.slug,
      repoRef: data.ref,
      unitTitle: nextUp.unitTitle,
      lessonTitle: nextUp.lesson.title,
      lessonIndex: nextUp.lesson.orderIndex + 1,
      lessonCount:
        data.units.find((u) => u.title === nextUp.unitTitle)?.lessons.length ?? 1,
      lessonSeq: nextUp.lesson.globalSeq,
      lessonSeqTotal: data.lessonCount,
    };
    return studyUrl(data.studyToolSlug, seed);
  }, [data, nextUp]);

  const avgScore = useMemo(() => {
    const rows = runs.data ?? [];
    const scored = rows.filter((r) => r.scoreTotal > 0);
    if (scored.length === 0) return null;
    const sum = scored.reduce((acc, r) => acc + r.scoreCorrect / r.scoreTotal, 0);
    return Math.round((sum / scored.length) * 100);
  }, [runs.data]);

  /* ---------------- mutations ---------------------------------------------- */
  const toggleFavorite = trpc.repos.toggleFavorite.useMutation({
    onSuccess: (res) => {
      toast.success(res.favorite ? 'Pinned to your favorites ★' : 'Removed from favorites');
      void utils.repos.getBySlug.invalidate({ slug });
      void utils.repos.list.invalidate();
    },
    onError: () => toast.error("Couldn't update favorites — try again"),
  });

  const rename = trpc.repos.update.useMutation({
    onSuccess: () => {
      toast.success('Saved ✓');
      void utils.repos.getBySlug.invalidate({ slug });
      void utils.repos.list.invalidate();
    },
    onError: (err) => toast.error(err.message || 'Could not rename — try again'),
  });

  const deleteRepo = trpc.repos.delete.useMutation({
    onSuccess: () => {
      toast.success('Notebook recycled 📒');
      void utils.repos.list.invalidate();
      navigate('/repos');
    },
    onError: (err) => toast.error(err.message || 'Could not delete — try again'),
  });

  /* ---------------- sticky sub-header on scroll ---------------------------- */
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 320);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ---------------- early states -------------------------------------------- */
  if (repo.isLoading) return <RepoSkeleton />;
  if (repo.isError || !data) {
    return (
      <div className="mx-auto max-w-content px-4 py-10">
        <SketchToaster />
        <EmptyState
          image="/empty-repos.svg"
          imageAlt="Missing notebook doodle"
          headline="This notebook isn't on the shelf"
          explainer={
            repo.error?.message?.includes('not found')
              ? 'It may have been deleted — or the link has a typo in it.'
              : "Something went wrong while opening it."
          }
          ctaLabel={repo.isError && !repo.error?.message?.includes('not found') ? 'Try again' : 'Back to Repos'}
          onCta={() => {
            if (repo.isError && !repo.error?.message?.includes('not found')) void repo.refetch();
            else navigate('/repos');
          }}
        />
      </div>
    );
  }

  const onFavorite = () => {
    if (isGuest) {
      setAuthWallOpen(true);
      return;
    }
    toggleFavorite.mutate({ slug: data.slug });
  };

  const onShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Public link copied — anyone can view this notebook');
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const onCopyRef = async () => {
    try {
      await navigator.clipboard.writeText(`#${data.ref}`);
      toast.success('Ref copied');
    } catch {
      toast.error("Couldn't copy the ref");
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 lg:px-8">
      <SketchToaster />
      <AuthWall
        open={authWallOpen}
        onClose={() => setAuthWallOpen(false)}
        message="Sign in to study lessons, pin favorites, and keep your own lesson logs."
      />

      {/* sticky sub-header */}
      <AnimatePresence>
        {stuck && (
          <motion.div
            initial={{ y: -56, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -56, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="fixed left-0 right-0 top-16 z-20 border-b-2 border-ink bg-paper-3/95 px-4 py-2 shadow-offset backdrop-blur-sm lg:left-[240px]"
          >
            <div className="mx-auto flex max-w-[1080px] items-center gap-3">
              <span className="min-w-0 flex-1 truncate font-heading font-semibold text-ink">
                {data.title}
              </span>
              <Chip kind="repo-ref">#{data.ref}</Chip>
              {nextUpUrl && !isGuest && (
                <Link to={nextUpUrl} className="no-underline">
                  <SketchButton variant="accent" size="sm">
                    <Clapperboard className="h-4 w-4" />
                    Continue course
                  </SketchButton>
                </Link>
              )}
              {isGuest && (
                <SketchButton variant="accent" size="sm" onClick={() => setAuthWallOpen(true)}>
                  <Clapperboard className="h-4 w-4" />
                  Study
                </SketchButton>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* breadcrumb */}
      <nav aria-label="Breadcrumb" className="micro flex items-center gap-1.5 text-[0.65rem] text-ink-faint">
        <Link to="/repos" className="text-blue no-underline hover:squiggle">
          Repos
        </Link>
        <span>/</span>
        <span className="text-ink-soft">{data.title}</span>
      </nav>

      {/* header */}
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="mt-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <EditableTitle
              title={data.title}
              canEdit={canEdit}
              saving={rename.isPending}
              onSave={(title) => rename.mutate({ slug: data.slug, title })}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => void onCopyRef()} title="Click to copy" className="no-underline">
                <Chip kind="repo-ref" className="cursor-copy">
                  #{data.ref}
                </Chip>
              </button>
              <span className="font-mono text-xs text-ink-faint">{data.slug}</span>
              <Chip kind="neutral" className="normal-case">
                <TemplateIcon template={data.template} className="h-3.5 w-3.5" />
                {meta.label}
              </Chip>
              {data.studyToolSlug && (
                <Link to={`/slides/${data.studyToolSlug}`} className="no-underline">
                  <Chip kind="slide-tool" className="transition-transform hover:-translate-y-0.5">
                    <Presentation className="h-3.5 w-3.5" />
                    {data.toolName ?? data.studyToolSlug}
                  </Chip>
                </Link>
              )}
              <span className="micro text-[0.6rem] text-ink-faint">
                sketched {relTime(data.createdAt)}
                {data.ownerName ? ` · by ${data.ownerName}` : ''}
              </span>
            </div>
            {canEdit && (
              <p className="mt-1.5 text-xs text-ink-faint">
                Renaming never breaks links — slug and <span className="font-mono">#{data.ref}</span> stay the same.
              </p>
            )}
          </div>

          {/* action bar */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onFavorite}
              aria-pressed={data.favorite}
              aria-label={data.favorite ? 'Remove from favorites' : 'Add to favorites'}
              className="flex h-10 w-10 items-center justify-center rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset transition-all hover:-translate-y-0.5 hover:shadow-offset-hover"
            >
              <Star
                className={cn('h-5 w-5', data.favorite ? 'fill-yellow text-ink' : 'text-ink-faint')}
                strokeWidth={2}
              />
            </button>
            <button
              type="button"
              onClick={() => void onShare()}
              aria-label="Share"
              className="flex h-10 w-10 items-center justify-center rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset transition-all hover:-translate-y-0.5 hover:shadow-offset-hover"
            >
              <Share2 className="h-5 w-5 text-ink" strokeWidth={2} />
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                aria-label="Delete repository"
                className="flex h-10 w-10 items-center justify-center rounded-wobble-sm border-2 border-ink bg-red-soft text-red shadow-offset transition-all hover:-translate-y-0.5 hover:bg-red hover:text-paper-3"
              >
                <Trash2 className="h-5 w-5" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </motion.header>

      {/* stats strip */}
      <section aria-label="Stats" className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard index={0} value={data.unitCount} label={meta.unitNoun + 's'} />
        <StatCard index={1} value={data.lessonCount} label={meta.lessonNoun + 's'} />
        <StatCard index={2} value={data.runCount} label="Runs" />
        <StatCard index={3} value={avgScore ?? 0} label="Avg score" suffix={avgScore === null ? '—' : '%'} />
      </section>

      {/* The old "Linked slide tool — pre-linked" card is gone: the wizard
          replaced that workflow, and the tool now lives on the Slides page
          wearing the repo's R-ref sticker instead. */}

      {/* owner leads (commercial repos only) */}
      {canEdit && repoPurpose(data.template) === 'commercial' && (
        <div className="mt-6">
          <RepoLeadsPanel slug={data.slug} />
        </div>
      )}

      {/* owner ticket dispenser (education repos, moderators/admins only) */}
      {canEdit &&
        (role === 'moderator' || role === 'admin') &&
        repoPurpose(data.template) === 'education' && (
          <div className="mt-6">
            <RepoTicketsPanel slug={data.slug} />
          </div>
        )}

      {/* course memory */}
      <div className="mt-6">
        <CourseMemoryPanel slug={data.slug} />
      </div>

      {/* units */}
      <section aria-label="Units and lessons" className="mt-8 flex flex-col gap-8">
        {data.units.length === 0 && (
          <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3/60 px-4 py-10 text-center text-ink-faint">
            This notebook has no {meta.unitNoun.toLowerCase()}s yet.
          </div>
        )}
        {data.units.map((unit, i) => (
          <UnitCard
            key={unit.id}
            unit={unit}
            unitIndex={i}
            repoSlug={data.slug}
            repoRef={data.ref}
            template={data.template}
            lessonSeqTotal={data.lessonCount}
            nextUpLessonId={nextUp?.lesson.id ?? null}
            playedCount={playedCount}
            isGuest={isGuest}
            canEdit={canEdit}
            onGuestStudy={() => setAuthWallOpen(true)}
          />
        ))}
        {canEdit && <AddUnitCard slug={data.slug} unitNoun={meta.unitNoun} />}
      </section>

      {/* saved presentations + lesson runs — ADMIN diagnostics only. The
          lessons above already carry Play/eye for everyone else; these raw
          tables are back-office views, not part of the course. */}
      {role === 'admin' && (
        <>
          <div className="mt-10">
            <SavedPresentationsTable slug={data.slug} canEdit={canEdit} units={data.units} />
          </div>
          <div className="mt-10">
            <LessonRunsTable slug={data.slug} repoRef={data.ref} unitByLessonId={unitByLessonId} />
          </div>
        </>
      )}

      {/* delete confirm modal */}
      <DeleteModal
        open={deleteOpen}
        title={data.title}
        lessonCount={flatLessons.length}
        deleting={deleteRepo.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteRepo.mutate({ slug: data.slug })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "+ Add unit" affordance (owner/admin)                               */
/* ------------------------------------------------------------------ */

function AddUnitCard({ slug, unitNoun }: { slug: string; unitNoun: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const createUnit = trpc.units.create.useMutation({
    onSuccess: () => {
      toast.success(`${unitNoun} added ✓`);
      void utils.repos.getBySlug.invalidate({ slug });
      setTitle('');
      setOpen(false);
    },
    onError: (err) => toast.error(err.message || 'Could not add — try again'),
  });

  const submit = () => {
    const next = title.trim();
    if (!next) {
      toast.error(`Give the ${unitNoun.toLowerCase()} a title`);
      return;
    }
    createUnit.mutate({ repoSlug: slug, title: next });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-3/40 px-4 py-4 font-heading text-base font-semibold text-ink-faint transition-colors hover:border-ink hover:text-ink"
      >
        <Plus className="h-5 w-5" strokeWidth={2} />
        Add {unitNoun.toLowerCase()}
      </button>
    );
  }

  return (
    <div className="relative rounded-wobble-2 border-2 border-dashed border-blue bg-paper-3/60 p-5 pt-7 shadow-offset">
      <WashiTape rotate={2} color="blue" className="left-1/2 -translate-x-1/2" />
      <label className="micro block text-[0.62rem] text-ink-faint" htmlFor="new-unit-title">
        New {unitNoun.toLowerCase()} — appended at the end
      </label>
      <input
        id="new-unit-title"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={`${unitNoun} title`}
        className="mt-2 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-heading text-lg font-bold text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB]"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <SketchButton variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </SketchButton>
        <SketchButton variant="accent" size="sm" loading={createUnit.isPending} onClick={submit}>
          <Plus className="h-4 w-4" />
          Add {unitNoun.toLowerCase()}
        </SketchButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline-editable title (owner/admin) — slug/ref never change         */
/* ------------------------------------------------------------------ */

function EditableTitle({
  title,
  canEdit,
  saving,
  onSave,
}: {
  title: string;
  canEdit: boolean;
  saving: boolean;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!canEdit) {
    return (
      <h1 className="font-display text-[40px] font-bold leading-tight text-ink">
        <Squiggle color="yellow">{title}</Squiggle>
      </h1>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next.length >= 3 && next !== title) onSave(next);
    else setDraft(title);
  };

  return (
    <div className="group flex items-start gap-2">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(title);
              setEditing(false);
            }
          }}
          disabled={saving}
          aria-label="Repository title"
          className="w-full rounded-wobble-sm border-2 border-blue bg-paper-3 px-2 py-1 font-display text-[40px] font-bold leading-tight text-ink shadow-[4px_4px_0_#DDE9FB] outline-none"
        />
      ) : (
        <>
          <h1 className="font-display text-[40px] font-bold leading-tight text-ink">
            <Squiggle color="yellow">{title}</Squiggle>
          </h1>
          <button
            type="button"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
            aria-label="Rename repository"
            title="Rename (links never break)"
            className="mt-2 rounded-wobble-sm p-1.5 text-ink-faint opacity-0 transition-all hover:bg-paper-2 hover:text-ink focus:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="h-5 w-5" strokeWidth={2} />
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat card with count-up (repository.md §2)                          */
/* ------------------------------------------------------------------ */

function StatCard({
  index,
  value,
  label,
  suffix = '',
}: {
  index: number;
  value: number;
  label: string;
  suffix?: string;
}) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => `${Math.round(v)}${suffix}`);

  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 * index, ease: EASE }}
      className={cn(
        'border-2 border-ink bg-paper-3 p-4 text-center shadow-offset',
        index % 4 === 0 && 'rounded-wobble-1',
        index % 4 === 1 && 'rounded-wobble-2',
        index % 4 === 2 && 'rounded-wobble-3',
        index % 4 === 3 && 'rounded-wobble-4',
      )}
    >
      <motion.p className="font-display text-4xl font-bold leading-none text-ink">
        {rounded}
      </motion.p>
      <p className="micro mt-1.5 text-[0.62rem] text-ink-soft">{label}</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Delete modal — type-the-title confirm                               */
/* ------------------------------------------------------------------ */

function DeleteModal({
  open,
  title,
  lessonCount,
  deleting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  lessonCount: number;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const matches = typed.trim() === title;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Delete repository"
            className="relative w-full max-w-[560px] rounded-wobble-2 border-2 border-ink bg-paper-3 p-8 pt-10 shadow-offset"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <WashiTape rotate={-4} className="left-8" />
            <WashiTape rotate={3} color="blue" className="left-auto right-8" />
            <h2 className="font-display text-4xl text-ink">Recycle this notebook?</h2>
            <p className="mt-2 text-sm text-ink-soft">
              This tears out <span className="font-bold text-ink">{title}</span> and its{' '}
              {lessonCount} lessons for good. The linked slide tool stays on your shelf.
            </p>
            <label className="micro mt-4 block text-ink-soft" htmlFor="delete-confirm">
              Type the title to confirm
            </label>
            <input
              id="delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={title}
              className="mt-1.5 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3.5 py-2.5 text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-red focus:shadow-[4px_4px_0_#FADFDB]"
            />
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <SketchButton variant="ghost" onClick={onClose}>
                Keep it
              </SketchButton>
              <SketchButton
                variant="danger"
                disabled={!matches}
                loading={deleting}
                onClick={onConfirm}
              >
                <Trash2 className="h-4 w-4" />
                Delete forever
              </SketchButton>
            </div>
            {matches && (
              <p className="mt-2 flex items-center gap-1 text-xs text-green">
                <Check className="h-3.5 w-3.5" /> title matches
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

function RepoSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-8 lg:px-8" aria-label="Loading repository">
      <div className="skeleton-stroke h-4 w-40" />
      <div className="skeleton-stroke mt-4 h-12 w-2/3" />
      <div className="mt-3 flex gap-2">
        <div className="skeleton-stroke h-6 w-20" />
        <div className="skeleton-stroke h-6 w-32" />
        <div className="skeleton-stroke h-6 w-24" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-stroke h-20" />
        ))}
      </div>
      <div className="skeleton-stroke mt-6 h-40 w-full" />
      <div className="skeleton-stroke mt-4 h-40 w-full" />
      <p className="mt-4 text-center text-sm text-ink-faint">Opening the notebook…</p>
    </div>
  );
}
