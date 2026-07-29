import { useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Clapperboard,
  Clock,
  Eye,
  Hourglass,
  Pencil,
  PencilRuler,
  Plus,
  Repeat,
  RotateCcw,
  Sparkles,
  Square,
  Ticket,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Chip from '@/components/sketch/Chip';
import SketchButton from '@/components/sketch/SketchButton';
import WashiTape from '@/components/sketch/WashiTape';
import { DoodleCheck } from '@/components/sketch/DoodleIcons';
import { trpc } from '@/providers/trpc';
import CreateToolModal from '@/components/slides/CreateToolModal';
import type { LessonSeed, RepoLesson, RepoPurpose, RepoTemplate, RepoUnit } from '@contracts/types';
import { repoPurpose } from '@contracts/types';
import { TEMPLATE_META } from './shared';

export interface UnitCardProps {
  unit: RepoUnit;
  unitIndex: number;
  repoSlug: string;
  repoRef: string;
  template: RepoTemplate;
  lessonSeqTotal: number;
  /** id of the first unplayed lesson (the "next-up" one) */
  nextUpLessonId: number | null;
  /** how many lessons have ≥1 run — for the "Builds on N lessons" tooltip */
  playedCount: number;
  isGuest: boolean;
  /** owner/admin — shows the unit & lesson editing controls */
  canEdit: boolean;
  onGuestStudy: () => void;
}

/** mm:ss from seconds */
function fmtMMSS(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Unit card (repository.md §5): dashed pencil border, washi tape, circled unit
 * number, collapsible; nested dotted lesson cards with course-order badges,
 * objective prompt cards and 🎬 Study buttons; sub-lessons nest one level deeper.
 * Owners/admins also get inline rename, add-lesson and delete controls.
 */
export default function UnitCard({
  unit,
  unitIndex,
  repoSlug,
  repoRef,
  template,
  lessonSeqTotal,
  nextUpLessonId,
  playedCount,
  isGuest,
  canEdit,
  onGuestStudy,
}: UnitCardProps) {
  const [open, setOpen] = useState(true);
  const meta = TEMPLATE_META[template] ?? TEMPLATE_META.other;
  const purpose = repoPurpose(template);
  const utils = trpc.useUtils();

  const refresh = () => {
    void utils.repos.getBySlug.invalidate({ slug: repoSlug });
    void utils.repos.courseMemory.invalidate({ slug: repoSlug });
  };
  const onError = (err: { message?: string }) =>
    toast.error(err.message || 'Could not save — try again');

  /* ---------------- unit mutations ---------------- */
  const renameUnit = trpc.units.update.useMutation({
    onSuccess: () => {
      toast.success(`${meta.unitNoun} renamed ✓`);
      refresh();
    },
    onError,
  });
  const deleteUnit = trpc.units.delete.useMutation({
    onSuccess: () => {
      toast.success(`${meta.unitNoun} torn out 🗑`);
      refresh();
    },
    onError,
  });

  /* ---------------- lesson mutations -------------- */
  const createLesson = trpc.lessons.create.useMutation({
    onSuccess: () => {
      toast.success(`${meta.lessonNoun} added ✓`);
      refresh();
    },
    onError,
  });
  const updateLesson = trpc.lessons.update.useMutation({
    onSuccess: () => {
      toast.success('Saved ✓');
      refresh();
    },
    onError,
  });
  const deleteLesson = trpc.lessons.delete.useMutation({
    onSuccess: () => {
      toast.success(`${meta.lessonNoun} deleted`);
      refresh();
    },
    onError,
  });

  /* ---------------- local UI state ---------------- */
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(unit.title);
  const [confirmDeleteUnit, setConfirmDeleteUnit] = useState(false);
  const [addingLesson, setAddingLesson] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newObjective, setNewObjective] = useState('');

  const commitRename = () => {
    const next = renameDraft.trim();
    setRenaming(false);
    if (next.length > 0 && next !== unit.title) {
      renameUnit.mutate({ unitId: unit.id, title: next });
    } else {
      setRenameDraft(unit.title);
    }
  };

  const submitNewLesson = () => {
    const title = newTitle.trim();
    const objective = newObjective.trim();
    if (!title || !objective) {
      toast.error(`Give the ${meta.lessonNoun.toLowerCase()} a title and an ${meta.objectiveNoun.toLowerCase()}`);
      return;
    }
    createLesson.mutate(
      { unitId: unit.id, title, objective },
      {
        onSuccess: () => {
          setNewTitle('');
          setNewObjective('');
          setAddingLesson(false);
        },
      },
    );
  };

  const topLevel = unit.lessons
    .filter((l) => l.parentLessonId == null)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const subByParent = new Map<number, RepoLesson[]>();
  for (const l of unit.lessons) {
    if (l.parentLessonId != null) {
      const list = subByParent.get(l.parentLessonId) ?? [];
      list.push(l);
      subByParent.set(l.parentLessonId, list);
    }
  }
  for (const list of subByParent.values()) list.sort((a, b) => a.orderIndex - b.orderIndex);

  const buildSeed = (lesson: RepoLesson): LessonSeed => ({
    repoSlug,
    repoRef,
    unitTitle: unit.title,
    lessonTitle: lesson.title,
    lessonIndex: lesson.orderIndex + 1,
    lessonCount: unit.lessons.length,
    lessonSeq: lesson.globalSeq,
    lessonSeqTotal,
  });

  const lessonControls = canEdit
    ? {
        onSaveObjective: (lessonId: number, objective: string) =>
          updateLesson.mutate({ lessonId, objective }),
        onDelete: (lessonId: number) => deleteLesson.mutate({ lessonId }),
        updating: updateLesson.isPending,
        deleting: deleteLesson.isPending,
      }
    : undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: unitIndex * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="relative rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-3/60 p-5 pt-7 shadow-offset"
    >
      <WashiTape rotate={unitIndex % 2 === 0 ? -3 : 2} className="left-1/2 -translate-x-1/2" />

      {/* unit header */}
      {renaming ? (
        <div className="flex w-full items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper-3 font-display text-2xl font-bold text-ink shadow-offset">
            {unitIndex + 1}
          </span>
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setRenameDraft(unit.title);
                setRenaming(false);
              }
            }}
            disabled={renameUnit.isPending}
            aria-label={`${meta.unitNoun} title`}
            className="min-w-0 flex-1 rounded-wobble-sm border-2 border-blue bg-paper px-2 py-1 font-heading text-xl font-bold text-ink shadow-[4px_4px_0_#DDE9FB] outline-none"
          />
        </div>
      ) : (
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper-3 font-display text-2xl font-bold text-ink shadow-offset">
              {unitIndex + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="micro block text-[0.62rem] text-ink-faint">
                {meta.unitNoun} {unitIndex + 1}
              </span>
              <span className="block truncate font-heading text-xl font-bold text-ink">
                {unit.title}
              </span>
            </span>
            <span className="micro whitespace-nowrap text-[0.62rem] text-ink-faint">
              {unit.lessons.length} {unit.lessons.length === 1 ? meta.lessonNoun.toLowerCase() : `${meta.lessonNoun.toLowerCase()}s`}
            </span>
          </button>
          {canEdit && (
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setRenameDraft(unit.title);
                  setRenaming(true);
                }}
                aria-label={`Rename ${meta.unitNoun.toLowerCase()}`}
                title="Rename"
                className="rounded-wobble-sm p-1.5 text-ink-faint transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <Pencil className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteUnit(true)}
                aria-label={`Delete ${meta.unitNoun.toLowerCase()}`}
                title="Delete"
                className="rounded-wobble-sm p-1.5 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse unit' : 'Expand unit'}
            className="shrink-0 rounded-wobble-sm p-1 text-ink hover:bg-paper-2"
          >
            <ChevronDown
              className={cn('h-5 w-5 transition-transform duration-200', open && 'rotate-180')}
            />
          </button>
        </div>
      )}

      {/* unit delete confirm strip */}
      <AnimatePresence initial={false}>
        {confirmDeleteUnit && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-wobble-sm border-2 border-red bg-red-soft px-3 py-2">
              <span className="min-w-0 flex-1 text-sm font-bold text-red">
                Tear out “{unit.title}” and its {unit.lessons.length}{' '}
                {unit.lessons.length === 1 ? meta.lessonNoun.toLowerCase() : `${meta.lessonNoun.toLowerCase()}s`}?
              </span>
              <SketchButton
                variant="danger"
                size="sm"
                loading={deleteUnit.isPending}
                onClick={() => deleteUnit.mutate({ unitId: unit.id })}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </SketchButton>
              <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDeleteUnit(false)}>
                Cancel
              </SketchButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-4 flex flex-col gap-3 border-l-2 border-dashed border-pencil pl-4 sm:pl-6">
              {topLevel.length === 0 && (
                <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/60 px-4 py-6 text-center text-sm text-ink-faint">
                  No {meta.lessonNoun.toLowerCase()}s yet
                </div>
              )}
              {topLevel.map((lesson) => (
                <div key={lesson.id} className="flex flex-col gap-3">
                  <LessonCard
                    lesson={lesson}
                    badge={`${meta.lessonNoun} ${lesson.globalSeq} of ${lessonSeqTotal}`}
                    seed={buildSeed(lesson)}
                    objectiveLabel={meta.objectiveNoun}
                    purpose={purpose}
                    template={template}
                    isNextUp={lesson.id === nextUpLessonId}
                    playedCount={playedCount}
                    isGuest={isGuest}
                    onGuestStudy={onGuestStudy}
                    controls={lessonControls}
                  />
                  {/* sub-lessons nest one level deeper */}
                  {(subByParent.get(lesson.id) ?? []).map((sub, subIdx) => (
                    <div key={sub.id} className="ml-6 border-l-2 border-dotted border-pencil pl-4 sm:ml-8">
                      <LessonCard
                        lesson={sub}
                        badge={`${meta.lessonNoun} ${lesson.globalSeq}.${subIdx + 1} of ${lessonSeqTotal}`}
                        seed={buildSeed(sub)}
                        objectiveLabel={meta.objectiveNoun}
                            purpose={purpose}
                        template={template}
                        isNextUp={sub.id === nextUpLessonId}
                        playedCount={playedCount}
                        isGuest={isGuest}
                        onGuestStudy={onGuestStudy}
                        sub
                        controls={lessonControls}
                      />
                    </div>
                  ))}
                </div>
              ))}

              {/* add-lesson affordance (owner/admin) */}
              {canEdit &&
                (addingLesson ? (
                  <div className="rounded-wobble-sm border-2 border-dashed border-blue bg-paper px-3 py-3">
                    <span className="micro block text-[0.58rem] text-ink-faint">
                      New {meta.lessonNoun.toLowerCase()} — added at the end of this {meta.unitNoun.toLowerCase()}
                    </span>
                    <input
                      autoFocus
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={`${meta.lessonNoun} title`}
                      aria-label={`New ${meta.lessonNoun.toLowerCase()} title`}
                      className="mt-2 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 font-heading text-sm font-semibold text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                    />
                    <textarea
                      value={newObjective}
                      onChange={(e) => setNewObjective(e.target.value)}
                      placeholder={`${meta.objectiveNoun} / prompt — this exact text seeds the slide tool`}
                      aria-label={`New ${meta.lessonNoun.toLowerCase()} ${meta.objectiveNoun.toLowerCase()}`}
                      rows={3}
                      className="mt-2 w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 font-mono text-[0.8rem] leading-relaxed text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <SketchButton variant="ghost" size="sm" onClick={() => setAddingLesson(false)}>
                        Cancel
                      </SketchButton>
                      <SketchButton
                        variant="accent"
                        size="sm"
                        loading={createLesson.isPending}
                        onClick={submitNewLesson}
                      >
                        <Plus className="h-4 w-4" />
                        Add {meta.lessonNoun.toLowerCase()}
                      </SketchButton>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingLesson(true)}
                    className="flex items-center justify-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 px-3 py-2 font-heading text-sm font-semibold text-ink-faint transition-colors hover:border-ink hover:text-ink"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} />
                    Add {meta.lessonNoun.toLowerCase()}
                  </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */

interface LessonControls {
  onSaveObjective: (lessonId: number, objective: string) => void;
  onDelete: (lessonId: number) => void;
  updating: boolean;
  deleting: boolean;
}

function LessonCard({
  lesson,
  badge,
  seed,
  objectiveLabel,
  purpose,
  template,
  isNextUp,
  playedCount,
  isGuest,
  onGuestStudy,
  sub = false,
  controls,
}: {
  lesson: RepoLesson;
  badge: string;
  seed: LessonSeed;
  objectiveLabel: string;
  purpose: RepoPurpose;
  template: RepoTemplate;
  isNextUp: boolean;
  playedCount: number;
  isGuest: boolean;
  onGuestStudy: () => void;
  sub?: boolean;
  controls?: LessonControls;
}) {
  const [objectiveOpen, setObjectiveOpen] = useState(false);
  const [editingObjective, setEditingObjective] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState(lesson.objective);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * Which wizard run is open, if any. "set" builds the repo's free preset,
   * "configure" builds the viewer's own version. Both used to be links to the
   * slide tool's settings page — the screen the creation wizard replaced
   * everywhere else, so a repo lesson was the last place still asking the old
   * questions.
   */
  const [wizard, setWizard] = useState<'set' | 'configure' | null>(null);
  // Progress chips reflect ONLY the signed-in viewer's own runs
  const completed = lesson.myStatus === 'completed';
  const tryAgain = lesson.myStatus === 'try-again';

  const utils = trpc.useUtils();
  const deletePreset = trpc.repos.deleteLessonPreset.useMutation({
    onSuccess: () => {
      toast.success('Preset cleared');
      void utils.repos.getBySlug.invalidate({ slug: seed.repoSlug });
    },
  });

  const isOwner = !!controls;
  // Commercial showcases, walkthroughs AND news briefings share the "generate
  // once, everyone watches the free preset" model — no quizzes, no per-viewer
  // customization.
  const presetOnly = purpose !== 'education';
  const playHref = `/repos/${seed.repoSlug}/play/${seed.lessonSeq}`;
  const editHref = `/repos/${seed.repoSlug}/play/${seed.lessonSeq}/edit`;
  const mineHref = `/repos/${seed.repoSlug}/play/${seed.lessonSeq}/mine`;

  // How many customization tickets the signed-in viewer holds for this repo —
  // relevant whenever a non-owner could customize an education repo (whether or
  // not it has a free preset).
  const mayCustomize = purpose === 'education' && !isOwner && !isGuest;
  const ticketQ = trpc.tickets.availableFor.useQuery(
    { repoSlug: seed.repoSlug },
    { enabled: mayCustomize },
  );
  const ticketCount = ticketQ.data?.count ?? 0;
  const requestTickets = trpc.tickets.request.useMutation({
    onSuccess: () => toast.success("Requested — the owner will get back to you (usually on WhatsApp)"),
    onError: (e) => toast.error(e.message),
  });

  // "Configure" — generate your OWN playable slide with the settings you like.
  // The wizard passes intent=configure so the slide tool saves it as a personal
  // customization (not the repo preset), so even the owner/admin can make their
  // own version.
  const cfgChip =
    'micro flex items-center gap-1 rounded-wobble-sm border border-ink bg-blue-soft px-1.5 py-0.5 text-[0.58rem] font-semibold text-ink no-underline transition-colors hover:bg-blue/20';
  const cfgChipDashed =
    'micro flex items-center gap-1 rounded-wobble-sm border border-dashed border-pencil px-1.5 py-0.5 text-[0.58rem] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink';

  /** Meta-row control: configure your own playable slide (+ play your saved one). */
  const configureMeta = () => {
    if (purpose !== 'education') return null;
    if (isGuest)
      return (
        <button type="button" onClick={onGuestStudy} className={cfgChipDashed} title="Sign in to configure your own version">
          <Wand2 className="h-3 w-3" strokeWidth={2} /> Configure
        </button>
      );
    const hasCfg = lesson.myHasCustomization;
    // Owner/admin can configure without a ticket (charged to their credits);
    // a non-owner spends a moderator-issued ticket.
    const canNow = isOwner || ticketCount > 0;
    return (
      <span className="flex items-center gap-1">
        {hasCfg && (
          <Link to={mineHref} className={cfgChip} title="Play the version you configured">
            <Sparkles className="h-3 w-3" strokeWidth={2} /> Play yours
          </Link>
        )}
        {canNow ? (
          <button
            type="button"
            onClick={() => setWizard('configure')}
            className={cfgChip}
            title={
              isOwner
                ? 'Generate your own configured version (uses your credits)'
                : `Configure your own version — you have ${ticketCount} ticket${ticketCount === 1 ? '' : 's'}`
            }
          >
            <Wand2 className="h-3 w-3" strokeWidth={2} /> {hasCfg ? 'Reconfigure' : 'Configure'}
            {!isOwner && (
              <span className="rounded-full bg-green-soft px-1 text-[0.5rem] font-bold text-green">
                {ticketCount}
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => requestTickets.mutate({ repoSlug: seed.repoSlug, count: 1, note: '' })}
            disabled={requestTickets.isPending}
            className={cfgChipDashed}
            title="Ask the repo's owner for a customization ticket"
          >
            <Ticket className="h-3 w-3" strokeWidth={2} /> Request ticket
          </button>
        )}
      </span>
    );
  };

  const studyTitle =
    playedCount > 0
      ? `Opens the slide tool with this lesson's prompt · Builds on ${playedCount} completed lesson${playedCount === 1 ? '' : 's'} ✦`
      : "Opens the slide tool with this lesson's prompt";

  // Never disabled for a missing study tool: the repo creates one on demand
  // when the wizard runs. Half the repos here have none, and a dead accent
  // button reading "Set" was the worst of both — it looked like the way in.
  const ActionBtn = ({ label, title }: { label: string; title?: string }) => (
    <SketchButton variant="accent" size="sm" title={title ?? studyTitle}>
      <Clapperboard className="h-4 w-4" strokeWidth={2} />
      {label}
    </SketchButton>
  );

  /** The right button for this item, given purpose / ownership / preset. */
  const renderAction = () => {
    // Menu / service / shop / walkthrough: generate ONCE, then everyone watches
    // the preset (no quizzes, no per-viewer customization).
    if (presetOnly) {
      if (lesson.hasPreset) {
        return (
          <span className="flex items-center gap-1.5">
            <Link to={playHref} className="no-underline">
              <SketchButton variant="accent" size="sm">
                <Clapperboard className="h-4 w-4" strokeWidth={2} /> Play
              </SketchButton>
            </Link>
            {isOwner && (
              <Link to={editHref} title="Edit this preset's slides" className="no-underline">
                <button
                  type="button"
                  className="rounded-wobble-sm border-2 border-pencil p-1.5 text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  aria-label="Edit preset"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </Link>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={() =>
                  deletePreset.mutate({ repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq })
                }
                disabled={deletePreset.isPending}
                title="Clear preset"
                aria-label="Clear preset"
                className="rounded-wobble-sm border-2 border-transparent p-1.5 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </span>
        );
      }
      // no preset yet: owner sets it; everyone else sees nothing to play
      if (!isOwner) return null;
      return isGuest ? (
        <span onClick={onGuestStudy}>
          <ActionBtn label="Set" title="Generate this item's presentation, then save it as a preset" />
        </span>
      ) : (
        <span onClick={() => setWizard('set')}>
          <ActionBtn label="Set" title="Generate this item's presentation, then save it as a preset" />
        </span>
      );
    }
    // Education. Two paths, per the free/paid model:
    //  • FREE preset (if the owner has set one): anyone — including users with
    //    no credits — can watch it. AI-graded evaluations were stripped on save,
    //    so a free play costs nothing.
    //  • PAID custom generation ("Customize"): a signed-in student spends a
    //    customization TICKET the owner gifted them to generate their own
    //    version. Personal credits are never charged for repo customization.

    // The owner's own generate link (they build with their own credits).
    const ownerGenerate = (label: string, title?: string) =>
      isGuest ? (
        <span onClick={onGuestStudy}>
          <ActionBtn label={label} title={title} />
        </span>
      ) : (
        // Not gated on studyToolSlug: the repo grows one on demand when the
        // wizard runs, so a repo without a tool is no longer a dead button.
        <span onClick={() => setWizard('set')} title={title ?? studyTitle}>
          <ActionBtn label={label} title={title} />
        </span>
      );

    // Owner: build / edit the free preset with their own credits.
    if (isOwner) {
      if (!lesson.hasPreset)
        return ownerGenerate(
          'Set',
          'Generate this lesson, then save it as the free preset for everyone',
        );
      return (
        <span className="flex items-center gap-1.5">
          <Link to={playHref} className="no-underline">
            <SketchButton variant="accent" size="sm" title="Watch the free version">
              <Clapperboard className="h-4 w-4" strokeWidth={2} /> Play
            </SketchButton>
          </Link>
          <Link to={editHref} title="Edit the free preset's slides" className="no-underline">
            <button
              type="button"
              className="rounded-wobble-sm border-2 border-pencil p-1.5 text-ink-soft transition-colors hover:border-ink hover:text-ink"
              aria-label="Edit preset"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </Link>
          <button
            type="button"
            onClick={() => deletePreset.mutate({ repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq })}
            disabled={deletePreset.isPending}
            title="Clear the free preset"
            aria-label="Clear preset"
            className="rounded-wobble-sm border-2 border-transparent p-1.5 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </span>
      );
    }

    // Non-owner with a free preset: watch it free. Configuring their own paid
    // version lives in the meta row (next to the status stickers).
    if (lesson.hasPreset) {
      return (
        <Link to={playHref} className="no-underline">
          <SketchButton variant="accent" size="sm" title="Watch the free version — no credits needed">
            <Clapperboard className="h-4 w-4" strokeWidth={2} /> Play
          </SketchButton>
        </Link>
      );
    }
    // Non-owner, no free preset: configuring (meta row) is the only path.
    return null;
  };

  const saveObjective = () => {
    const next = objectiveDraft.trim();
    if (!next) {
      toast.error(`${objectiveLabel} can't be empty`);
      return;
    }
    setEditingObjective(false);
    if (next !== lesson.objective) controls?.onSaveObjective(lesson.id, next);
    else setObjectiveDraft(lesson.objective);
  };

  return (
    <article
      className={cn(
        'rounded-wobble-sm border-2 border-dotted border-pencil bg-paper-3 p-4 shadow-offset',
        sub && 'border-pencil/70 text-sm',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip kind="repo-ref" className="font-normal">
          {badge}
        </Chip>
        {completed ? (
          <span
            title={
              lesson.myBestTotal > 0
                ? `Completed — best score ${lesson.myBestCorrect}/${lesson.myBestTotal}`
                : 'Completed'
            }
            className="flex items-center gap-1 text-green"
          >
            <DoodleCheck className="h-4 w-4" />
            <span className="micro text-[0.6rem]">
              completed
              {lesson.myBestTotal > 0 && ` · ${lesson.myBestCorrect}/${lesson.myBestTotal}`}
            </span>
          </span>
        ) : tryAgain ? (
          <span
            title={`Best score ${lesson.myBestCorrect}/${lesson.myBestTotal} — pass to mark this lesson completed`}
            className="flex animate-low-pulse items-center gap-1 text-red"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="micro text-[0.6rem]">
              try again · {lesson.myBestCorrect}/{lesson.myBestTotal}
            </span>
          </span>
        ) : isNextUp ? (
          <span title="Next up" className="flex animate-low-pulse items-center gap-1 text-[#b8860b]">
            <Hourglass className="h-3.5 w-3.5" />
            <span className="micro text-[0.6rem]">next up</span>
          </span>
        ) : (
          <span title="Unplayed" className="flex items-center gap-1 text-ink-faint">
            <Square className="h-3.5 w-3.5" />
            <span className="micro text-[0.6rem]">unplayed</span>
          </span>
        )}
        {/* owner: build a playable presentation by hand (only until one is set) */}
        {isOwner && !lesson.hasPreset && (
          <Link
            to={editHref}
            title="Build a playable presentation by hand — no AI"
            className="micro flex items-center gap-1 rounded-wobble-sm border border-ink bg-purple-soft px-1.5 py-0.5 text-[0.58rem] font-semibold text-ink no-underline transition-colors hover:bg-purple/20"
          >
            <PencilRuler className="h-3 w-3" /> Manual
          </Link>
        )}
        {/* configure your own playable slide (education), next to the stickers */}
        {configureMeta()}
        {/* best-run meta: the HIGHEST score's level + time, how many times the
            viewer has played it, and a link to replay that best run's
            answers (only once the viewer has played it) */}
        {(completed || tryAgain) && (
          <>
            {lesson.myBestLevel && (
              <span
                title="Level of your best attempt"
                className="micro rounded-wobble-sm border border-pencil bg-paper-2 px-1.5 text-[0.58rem] text-ink-soft"
              >
                {lesson.myBestLevel}
              </span>
            )}
            {lesson.myBestElapsedSec > 0 && (
              <span
                title="Time of your best attempt"
                className="micro flex items-center gap-0.5 text-[0.58rem] text-ink-faint"
              >
                <Clock className="h-3 w-3" />
                {fmtMMSS(lesson.myBestElapsedSec)}
              </span>
            )}
            {lesson.myAttempts > 0 && (
              <span
                title={`You have played this lesson ${lesson.myAttempts} time${lesson.myAttempts === 1 ? '' : 's'}`}
                className="micro flex items-center gap-0.5 text-[0.58rem] text-ink-faint"
              >
                <Repeat className="h-3 w-3" />
                {lesson.myAttempts}×
              </span>
            )}
            {lesson.myBestRunId != null && (
              <Link
                to={`/runs/${lesson.myBestRunId}/replay`}
                title="Open your highest-scoring run — its slides and the answers you gave"
                className="micro flex items-center gap-1 rounded-wobble-sm border border-ink bg-paper-2 px-1.5 py-0.5 text-[0.58rem] font-semibold text-ink no-underline transition-colors hover:bg-blue-soft"
              >
                <Eye className="h-3 w-3" />
                Best run
              </Link>
            )}
          </>
        )}
        {controls && (
          <span className="ml-auto flex items-center gap-1">
            {confirmDelete ? (
              <>
                <span className="micro text-[0.6rem] font-bold text-red">delete?</span>
                <button
                  type="button"
                  onClick={() => controls.onDelete(lesson.id)}
                  disabled={controls.deleting}
                  aria-label="Confirm delete"
                  title="Confirm delete"
                  className="rounded-wobble-sm p-1 text-red transition-colors hover:bg-red-soft"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  aria-label="Cancel delete"
                  title="Cancel"
                  className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-paper-2 hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete lesson"
                title="Delete lesson"
                className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className={cn('font-heading font-semibold text-ink', sub ? 'text-base' : 'text-lg')}>
            {lesson.title}
          </h4>
          <p className="mt-0.5 line-clamp-1 text-sm text-ink-soft">{lesson.objective}</p>
        </div>
        {renderAction()}
      </div>

      {/* prompt card — exactly the string seeded into the slide tool */}
      {editingObjective && controls ? (
        <div className="mt-3 rounded-wobble-sm border border-blue bg-paper px-3 py-2">
          <span className="micro block text-[0.58rem] text-ink-faint">
            {objectiveLabel} / prompt — editing
          </span>
          <textarea
            autoFocus
            value={objectiveDraft}
            onChange={(e) => setObjectiveDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setObjectiveDraft(lesson.objective);
                setEditingObjective(false);
              }
            }}
            rows={Math.min(8, Math.max(3, objectiveDraft.split('\n').length + 1))}
            aria-label={`Edit ${objectiveLabel.toLowerCase()}`}
            className="mt-1 block w-full resize-y bg-transparent font-mono text-[0.8rem] leading-relaxed text-ink-soft outline-none"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <SketchButton
              variant="ghost"
              size="sm"
              onClick={() => {
                setObjectiveDraft(lesson.objective);
                setEditingObjective(false);
              }}
            >
              Cancel
            </SketchButton>
            <SketchButton
              variant="accent"
              size="sm"
              loading={controls.updating}
              onClick={saveObjective}
            >
              <Check className="h-4 w-4" />
              Save
            </SketchButton>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-wobble-sm border border-pencil bg-paper px-3 py-2">
          <div className="micro flex items-center justify-between text-[0.58rem] text-ink-faint">
            <button
              type="button"
              onClick={() => setObjectiveOpen((o) => !o)}
              aria-expanded={objectiveOpen}
              className="uppercase tracking-[0.12em] hover:text-ink"
            >
              {objectiveLabel} / prompt
            </button>
            <span className="flex items-center gap-1.5">
              {controls && (
                <button
                  type="button"
                  onClick={() => {
                    setObjectiveDraft(lesson.objective);
                    setEditingObjective(true);
                  }}
                  aria-label={`Edit ${objectiveLabel.toLowerCase()}`}
                  title={`Edit ${objectiveLabel.toLowerCase()}`}
                  className="rounded-wobble-sm p-0.5 text-ink-faint transition-colors hover:text-ink"
                >
                  <Pencil className="h-3 w-3" strokeWidth={2} />
                </button>
              )}
              <span className="font-mono normal-case tracking-normal">
                {lesson.objective.length} chars
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setObjectiveOpen((o) => !o)}
            aria-expanded={objectiveOpen}
            className="mt-1 block w-full text-left"
          >
            <span
              className={cn(
                'block font-mono text-[0.8rem] leading-relaxed text-ink-soft',
                !objectiveOpen && 'line-clamp-2',
              )}
            >
              {lesson.objective}
            </span>
          </button>
        </div>
      )}
      {/* The same wizard the Slides page uses, generating into the repo's own
          study tool rather than making a new one. The kind is fixed by the
          repo and the prompt starts from the lesson's objective, so it opens on
          the questions that are actually still open. */}
      {wizard && (
        <CreateToolModal
          open
          onClose={() => setWizard(null)}
          seed={seed}
          intent={wizard}
          lockedTemplate={template}
          initialTopic={lesson.objective || lesson.title}
        />
      )}
    </article>
  );
}
