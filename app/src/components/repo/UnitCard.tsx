import { useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Clapperboard,
  Clock,
  Eye,
  BookOpen,
  ChevronUp,
  Hourglass,
  Image as ImageIcon,
  KeyRound,
  Upload,
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
import SketchButton, { PencilSpinner } from '@/components/sketch/SketchButton';
import WashiTape from '@/components/sketch/WashiTape';
import { DoodleCheck } from '@/components/sketch/DoodleIcons';
import { trpc } from '@/providers/trpc';
import CreateToolModal from '@/components/slides/CreateToolModal';
import { useLessonGeneration } from '@/providers/lesson-generation';
import type {
  LessonSeed,
  RepoLesson,
  RepoPurpose,
  RepoTemplate,
  RepoUnit,
  UnitImage,
} from '@contracts/types';
import { repoPurpose } from '@contracts/types';
import { TEMPLATE_META } from './shared';
import { say } from '@/lib/i18n';

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
    toast.error(say(err.message || 'Could not save — try again'));

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
      toast.success(say("Saved ✓"));
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
  /** null = closed, 'choose' = pick a kind, then the form for that kind. */
  const [adding, setAdding] = useState<null | 'choose' | 'lesson' | 'image'>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageCaption, setImageCaption] = useState('');
  const [renameDraft, setRenameDraft] = useState(unit.title);
  const [confirmDeleteUnit, setConfirmDeleteUnit] = useState(false);
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

  const moveItem = trpc.unitImages.move.useMutation({
    onSuccess: (r) => {
      if (r.moved) refresh();
    },
    onError: (e) => toast.error(say(e.message)),
  });
  const addImage = trpc.unitImages.create.useMutation({
    onSuccess: (r) => {
      toast.success(r.cost > 0 ? `Image added — ${r.cost} 🪙` : 'Image added');
      setAdding(null);
      setImagePrompt('');
      setImageCaption('');
      refresh();
      // A generated image was paid for — the coin count in the top bar reads
      // auth.me, which nothing else here touches.
      if (r.cost > 0) void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(say(e.message)),
  });
  const removeImage = trpc.unitImages.remove.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => toast.error(say(e.message)),
  });

  /** Reads a picked file as base64 without the data: prefix. */
  const readAsBase64 = (file: File) =>
    new Promise<{ mime: string; data: string }>((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("That file couldn't be read"));
      fr.onload = () => {
        const out = String(fr.result);
        const comma = out.indexOf(',');
        resolve({ mime: file.type || 'image/png', data: comma >= 0 ? out.slice(comma + 1) : out });
      };
      fr.readAsDataURL(file);
    });

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { mime, data } = await readAsBase64(file);
      addImage.mutate({ unitId: unit.id, source: 'upload', mime, data, caption: imageCaption.trim() || undefined });
    } catch (err) {
      toast.error(say(err instanceof Error ? err.message : "That file couldn't be read"));
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
          setAdding(null);
        },
      },
    );
  };

  const topLevel = unit.lessons
    .filter((l) => l.parentLessonId == null)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  /**
   * Lessons and images in ONE sequence. They share an orderIndex space server
   * side precisely so a picture can sit above or below a lesson rather than in
   * a separate band of its own.
   */
  type UnitItem =
    | { kind: 'lesson'; id: number; orderIndex: number; lesson: RepoLesson }
    | { kind: 'image'; id: number; orderIndex: number; image: UnitImage };
  const items: UnitItem[] = [
    ...topLevel.map((l) => ({ kind: 'lesson' as const, id: l.id, orderIndex: l.orderIndex, lesson: l })),
    ...(unit.images ?? []).map((i) => ({
      kind: 'image' as const,
      id: i.id,
      orderIndex: i.orderIndex,
      image: i,
    })),
  ].sort((a, b) => a.orderIndex - b.orderIndex || a.kind.localeCompare(b.kind));
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
                title={say("Rename")}
                className="rounded-wobble-sm p-1.5 text-ink-faint transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <Pencil className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteUnit(true)}
                aria-label={`Delete ${meta.unitNoun.toLowerCase()}`}
                title={say("Delete")}
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
                
                {say("Tear out “")}{unit.title}{say("” and its")} {unit.lessons.length}{' '}
                {unit.lessons.length === 1 ? meta.lessonNoun.toLowerCase() : `${meta.lessonNoun.toLowerCase()}s`}?
              </span>
              <SketchButton
                variant="danger"
                size="sm"
                loading={deleteUnit.isPending}
                onClick={() => deleteUnit.mutate({ unitId: unit.id })}
              >
                <Trash2 className="h-4 w-4" />
                
                {say("Delete")}
              </SketchButton>
              <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDeleteUnit(false)}>
                
                {say("Cancel")}
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
                  
                  {say("No")} {meta.lessonNoun.toLowerCase()}{say("s yet")}
                </div>
              )}
              {items.map((item, idx) => (
                <div key={`${item.kind}-${item.id}`} className="flex gap-2">
                  {/* Move controls: one column beside the item so a picture and
                      a lesson are reordered the same way, by the same buttons. */}
                  {canEdit && items.length > 1 && (
                    <span className="flex shrink-0 flex-col justify-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          moveItem.mutate({ unitId: unit.id, kind: item.kind, id: item.id, direction: 'up' })
                        }
                        disabled={idx === 0 || moveItem.isPending}
                        aria-label={say("Move up")}
                        title={say("Move up")}
                        className="rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-faint transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          moveItem.mutate({ unitId: unit.id, kind: item.kind, id: item.id, direction: 'down' })
                        }
                        disabled={idx === items.length - 1 || moveItem.isPending}
                        aria-label={say("Move down")}
                        title={say("Move down")}
                        className="rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-faint transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                    </span>
                  )}
                  <div className="min-w-0 flex-1 flex flex-col gap-3">
                  {item.kind === 'image' ? (
                    <UnitImageCard
                      image={item.image}
                      canEdit={canEdit}
                      onRemove={() => removeImage.mutate({ imageId: item.id })}
                      onChanged={refresh}
                    />
                  ) : (
                  <>
                  {(() => { const lesson = item.lesson; return (<>
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
                  </>); })()}
                  </>
                  )}
                  </div>
                </div>
              ))}

              {/* add-lesson affordance (owner/admin) */}
              {canEdit && (
                <>
                  {adding === null && (
                    <button
                      type="button"
                      onClick={() => setAdding('choose')}
                      className="flex items-center justify-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 px-3 py-2 font-heading text-sm font-semibold text-ink-faint transition-colors hover:border-ink hover:text-ink"
                    >
                      <Plus className="h-4 w-4" strokeWidth={2} />
                      
                      {say("Add to this")} {meta.unitNoun.toLowerCase()}
                    </button>
                  )}

                  {/* Which kind first. Asking before the form means the image
                      path never has to pretend to be a lesson with a title. */}
                  {adding === 'choose' && (
                    <div className="rounded-wobble-sm border-2 border-dashed border-blue bg-paper px-3 py-3">
                      <span className="micro block text-[0.58rem] text-ink-faint">
                        
                        {say("What are you adding to this")} {meta.unitNoun.toLowerCase()}?
                      </span>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setAdding('lesson')}
                          className="flex flex-col items-start gap-0.5 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-left shadow-offset transition-transform hover:-translate-y-0.5"
                        >
                          <span className="flex items-center gap-1.5 font-heading text-sm font-bold text-ink">
                            <BookOpen className="h-4 w-4" strokeWidth={2} /> {meta.lessonNoun}
                          </span>
                          <span className="micro text-[0.58rem] text-ink-faint">
                            
                            {say("A title and a prompt — something to generate and play")}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdding('image')}
                          className="flex flex-col items-start gap-0.5 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-left shadow-offset transition-transform hover:-translate-y-0.5"
                        >
                          <span className="flex items-center gap-1.5 font-heading text-sm font-bold text-ink">
                            <ImageIcon className="h-4 w-4" strokeWidth={2} />  {say("Image")}
                          </span>
                          <span className="micro text-[0.58rem] text-ink-faint">
                            
                            {say("Upload one, or have the AI draw it")}
                          </span>
                        </button>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <SketchButton variant="ghost" size="sm" onClick={() => setAdding(null)}>
                          
                          {say("Cancel")}
                        </SketchButton>
                      </div>
                    </div>
                  )}

                  {adding === 'lesson' && (
                    <div className="rounded-wobble-sm border-2 border-dashed border-blue bg-paper px-3 py-3">
                      <span className="micro block text-[0.58rem] text-ink-faint">
                        
                        {say("New")} {meta.lessonNoun.toLowerCase()}  {say("— added at the end of this")} {meta.unitNoun.toLowerCase()}
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
                        <SketchButton variant="ghost" size="sm" onClick={() => setAdding(null)}>
                          
                          {say("Cancel")}
                        </SketchButton>
                        <SketchButton
                          variant="accent"
                          size="sm"
                          loading={createLesson.isPending}
                          onClick={submitNewLesson}
                        >
                          <Plus className="h-4 w-4" />
                          
                          {say("Add")} {meta.lessonNoun.toLowerCase()}
                        </SketchButton>
                      </div>
                    </div>
                  )}

                  {adding === 'image' && (
                    <div className="rounded-wobble-sm border-2 border-dashed border-blue bg-paper px-3 py-3">
                      <span className="micro block text-[0.58rem] text-ink-faint">
                        
                        {say("New image — added at the end, then move it wherever you want")}
                      </span>
                      <input
                        value={imageCaption}
                        onChange={(e) => setImageCaption(e.target.value)}
                        placeholder={say("Caption (optional)")}
                        aria-label={say("Image caption")}
                        className="mt-2 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                      />
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-2.5">
                          <span className="micro block text-[0.58rem] font-semibold text-ink-soft">
                            
                            {say("Upload — free")}
                          </span>
                          <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-1.5 font-heading text-sm font-bold text-ink shadow-offset">
                            <Upload className="h-4 w-4" strokeWidth={2} />  {say("Choose a file")}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                              className="hidden"
                              onChange={(e) => void onPickFile(e.target.files?.[0])}
                            />
                          </label>
                        </div>
                        <div className="rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-2.5">
                          <span className="micro block text-[0.58rem] font-semibold text-ink-soft">
                            
                            {say("Let the AI draw it — costs credits")}
                          </span>
                          <textarea
                            value={imagePrompt}
                            onChange={(e) => setImagePrompt(e.target.value)}
                            placeholder={say("What should it show?")}
                            rows={2}
                            aria-label={say("Image prompt")}
                            className="mt-2 w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 text-[0.8rem] text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                          />
                          <SketchButton
                            variant="accent"
                            size="sm"
                            className="mt-2 w-full justify-center"
                            loading={addImage.isPending}
                            disabled={imagePrompt.trim().length < 3}
                            onClick={() =>
                              addImage.mutate({
                                unitId: unit.id,
                                source: 'generate',
                                prompt: imagePrompt.trim(),
                                caption: imageCaption.trim() || undefined,
                              })
                            }
                          >
                            <Sparkles className="h-4 w-4" strokeWidth={2} />  {say("Generate")}
                          </SketchButton>
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <SketchButton variant="ghost" size="sm" onClick={() => setAdding(null)}>
                          
                          {say("Cancel")}
                        </SketchButton>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/**
 * A picture sitting in a unit's list. Deliberately the same footprint as a
 * lesson card — same border, same padding, same width — because the author
 * places it in that list and expects it to occupy a slot there, not float at a
 * different size.
 */
/**
 * A unit image, drawn as a banner: full card width, half a lesson card tall.
 * The picture is cropped to the strip (object-cover, centered) — the AI
 * prompt promises exactly this shape, so what it composes is what shows.
 * Editing offers replacing the picture in place: upload a different file, or
 * redraw it from a fresh prompt, without losing position or caption.
 */
function UnitImageCard({
  image,
  canEdit,
  onRemove,
  onChanged,
}: {
  image: UnitImage;
  canEdit: boolean;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const replace = trpc.unitImages.replace.useMutation({
    onSuccess: (r) => {
      toast.success(r.cost > 0 ? `Redrawn — ${r.cost} 🪙` : 'Image replaced');
      onChanged();
      if (r.cost > 0) void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(say(e.message)),
  });
  const onPickReplacement = (file: File | undefined) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onerror = () => toast.error(say("That file couldn't be read"));
    fr.onload = () => {
      const out = String(fr.result);
      const comma = out.indexOf(',');
      replace.mutate({
        imageId: image.id,
        source: 'upload',
        mime: file.type || 'image/png',
        data: comma >= 0 ? out.slice(comma + 1) : out,
      });
    };
    fr.readAsDataURL(file);
  };
  return (
    <figure className="relative rounded-wobble-sm border-2 border-dotted border-pencil bg-paper-3 p-2 shadow-offset">
      {canEdit && (
        <span className="absolute right-3 top-3 z-10 flex items-center gap-1">
          <label
            aria-label={say("Upload a replacement")}
            title={say("Upload a different picture in this spot")}
            className="cursor-pointer rounded-wobble-sm border-2 border-transparent bg-paper-3/80 p-1 text-ink-faint transition-colors hover:border-dashed hover:border-ink hover:text-ink"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={(e) => onPickReplacement(e.target.files?.[0])}
            />
          </label>
          {/* one press, no prompt: the server rewrites the prompt from the
              unit's own lessons and reseeds a fresh banner */}
          <button
            type="button"
            onClick={() => replace.mutate({ imageId: image.id, source: 'generate' })}
            disabled={replace.isPending}
            aria-label={say("Regenerate image")}
            title={say("Regenerate this banner from the unit's content (costs credits)")}
            className="rounded-wobble-sm border-2 border-transparent bg-paper-3/80 p-1 text-ink-faint transition-colors hover:border-dashed hover:border-ink hover:text-ink disabled:cursor-wait"
          >
            {replace.isPending ? <PencilSpinner /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={say("Remove image")}
            title={say("Remove image")}
            className="rounded-wobble-sm border-2 border-transparent bg-paper-3/80 p-1 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </span>
      )}
      {/* half a lesson card tall — a strip, not a poster */}
      <img
        src={image.url}
        alt={image.caption ?? ''}
        loading="lazy"
        className="h-16 w-full rounded-wobble-sm border-2 border-ink object-cover object-center sm:h-20"
      />
      {image.caption && (
        <figcaption className="mt-1.5 text-sm text-ink-soft">{image.caption}</figcaption>
      )}
    </figure>
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
  // A generation started here keeps running above the router, so this reads the
  // shared state rather than owning it — the spinner is still here after the
  // author wanders off to another page and comes back.
  const lessonGen = useLessonGeneration();
  const generating = lessonGen.isRunning(seed.repoSlug, seed.lessonSeq);

  /**
   * The lesson's answer key: a model run over the preset with every question
   * answered correctly. The owner publishes it once; anyone who can see the
   * lesson can then read it, which is what lets a student with no credits check
   * their answers without playing.
   */
  const answerKey = trpc.runs.answerKeyFor.useQuery(
    { repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq },
    { enabled: purpose === 'education' && lesson.hasPreset },
  );
  const publishKey = trpc.runs.createAnswerKey.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.answered > 0
          ? `Answer key written — a perfect ${r.answered}/${r.answered} run, read it under Best run ✓`
          : 'Answer key written — this deck has no questions',
      );
      void utils.runs.answerKeyFor.invalidate({ repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq });
      // The row's completed · score · time · counter chips all read getBySlug.
      void utils.repos.getBySlug.invalidate({ slug: seed.repoSlug });
    },
    onError: (e) => toast.error(say(e.message)),
  });
  // Progress chips reflect ONLY the signed-in viewer's own runs
  const completed = lesson.myStatus === 'completed';
  const tryAgain = lesson.myStatus === 'try-again';

  const utils = trpc.useUtils();
  const deletePreset = trpc.repos.deleteLessonPreset.useMutation({
    onSuccess: () => {
      toast.success(say("Preset cleared"));
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
    onSuccess: () => toast.success(say("Requested — the owner will get back to you (usually on WhatsApp)")),
    onError: (e) => toast.error(say(e.message)),
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
        <button type="button" onClick={onGuestStudy} className={cfgChipDashed} title={say("Sign in to configure your own version")}>
          <Wand2 className="h-3 w-3" strokeWidth={2} />  {say("Configure")}
        </button>
      );
    const hasCfg = lesson.myHasCustomization;
    // Owner/admin can configure without a ticket (charged to their credits);
    // a non-owner spends a moderator-issued ticket.
    const canNow = isOwner || ticketCount > 0;
    return (
      <span className="flex items-center gap-1">
        {hasCfg && (
          <Link to={mineHref} className={cfgChip} title={say("Play the version you configured")}>
            <Sparkles className="h-3 w-3" strokeWidth={2} />  {say("Play yours")}
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
            title={say("Ask the repo's owner for a customization ticket")}
          >
            <Ticket className="h-3 w-3" strokeWidth={2} />  {say("Request ticket")}
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

  /**
   * The answer-key button: just a key in a dashed outline, owner-only. Pressing
   * it writes a perfect run — the row then shows completed · full score · 4:42
   * with the key reachable through the Best run eye, so there is no separate
   * "Answers" chip. Once a fresh key exists the button disappears; it only
   * comes back when the presentation is edited or regenerated, because then a
   * new key is worth writing (and it adds one to the counter).
   */
  const answerKeyMeta = () => {
    if (purpose !== 'education' || !lesson.hasPreset || !isOwner) return null;
    const key = answerKey.data;
    if (key && !key.stale) return null; // a fresh key already stands as the best run
    return (
      <button
        type="button"
        onClick={() => publishKey.mutate({ repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq })}
        disabled={publishKey.isPending}
        aria-label={say("Answer key")}
        className={cfgChipDashed}
        title={
          key
            ? 'The presentation changed — write a fresh answer key (a new perfect run)'
            : 'Write the answer key: a perfect run students can read without credits'
        }
      >
        {publishKey.isPending ? <PencilSpinner /> : <KeyRound className="h-3 w-3" strokeWidth={2} />}
      </button>
    );
  };

  /** The right button for this item, given purpose / ownership / preset. */
  const renderAction = () => {
    // One control while a deck is being made: neither Set nor Play is true yet,
    // and offering either would misdescribe what pressing it does.
    if (generating) {
      // Spinner AND label: this wait runs 30-60 seconds, so a bare spinner
      // leaves the author guessing which of the row's buttons it replaced.
      return (
        <SketchButton
          variant="accent"
          size="sm"
          disabled
          title={say("Building this presentation — you can leave this page, it keeps going")}
        >
          <PencilSpinner />  {say("Building…")}
        </SketchButton>
      );
    }
    // Menu / service / shop / walkthrough: generate ONCE, then everyone watches
    // the preset (no quizzes, no per-viewer customization).
    if (presetOnly) {
      if (lesson.hasPreset) {
        return (
          <span className="flex items-center gap-1.5">
            <Link to={playHref} className="no-underline">
              <SketchButton variant="accent" size="sm">
                <Clapperboard className="h-4 w-4" strokeWidth={2} />  {say("Play")}
              </SketchButton>
            </Link>
            {/* the eye rides beside Play, like on the slide cards; the
                pencil moved up into the meta row */}
            {lesson.myBestRunId != null && (
              <Link
                to={`/runs/${lesson.myBestRunId}/replay`}
                title={say("Best run — every slide with its answers, free to read")}
                className="no-underline"
              >
                <button
                  type="button"
                  className="rounded-wobble-sm border-2 border-pencil p-1.5 text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  aria-label={say("Best run")}
                >
                  <Eye className="h-3.5 w-3.5" strokeWidth={2} />
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
                title={say("Clear preset")}
                aria-label={say("Clear preset")}
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
          <ActionBtn label="Set" title={say("Generate this item's presentation, then save it as a preset")} />
        </span>
      ) : (
        <span onClick={() => setWizard('set')}>
          <ActionBtn label="Set" title={say("Generate this item's presentation, then save it as a preset")} />
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
            <SketchButton variant="accent" size="sm" title={say("Watch the free version")}>
              <Clapperboard className="h-4 w-4" strokeWidth={2} />  {say("Play")}
            </SketchButton>
          </Link>
          {/* the eye rides beside Play, like on the slide cards; the
              pencil moved up into the meta row */}
          {lesson.myBestRunId != null && (
            <Link
              to={`/runs/${lesson.myBestRunId}/replay`}
              title={say("Best run — every slide with its answers, free to read")}
              className="no-underline"
            >
              <button
                type="button"
                className="rounded-wobble-sm border-2 border-pencil p-1.5 text-ink-soft transition-colors hover:border-ink hover:text-ink"
                aria-label={say("Best run")}
              >
                <Eye className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </Link>
          )}
          <button
            type="button"
            onClick={() => deletePreset.mutate({ repoSlug: seed.repoSlug, lessonSeq: seed.lessonSeq })}
            disabled={deletePreset.isPending}
            title={say("Clear the free preset")}
            aria-label={say("Clear preset")}
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
          <SketchButton variant="accent" size="sm" title={say("Watch the free version — no credits needed")}>
            <Clapperboard className="h-4 w-4" strokeWidth={2} />  {say("Play")}
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
              
              {say("completed")}
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
              
              {say("try again ·")} {lesson.myBestCorrect}/{lesson.myBestTotal}
            </span>
          </span>
        ) : isNextUp ? (
          <span title={say("Next up")} className="flex animate-low-pulse items-center gap-1 text-[#b8860b]">
            <Hourglass className="h-3.5 w-3.5" />
            <span className="micro text-[0.6rem]">{say("next up")}</span>
          </span>
        ) : (
          <span title={say("Unplayed")} className="flex items-center gap-1 text-ink-faint">
            <Square className="h-3.5 w-3.5" />
            <span className="micro text-[0.6rem]">{say("unplayed")}</span>
          </span>
        )}
        {/* owner: build a playable presentation by hand (only until one is set) */}
        {isOwner && !lesson.hasPreset && (
          <Link
            to={editHref}
            title={say("Build a playable presentation by hand — no AI")}
            className="micro flex items-center gap-1 rounded-wobble-sm border border-ink bg-purple-soft px-1.5 py-0.5 text-[0.58rem] font-semibold text-ink no-underline transition-colors hover:bg-purple/20"
          >
            <PencilRuler className="h-3 w-3" />  {say("Manual")}
          </Link>
        )}
        {/* configure your own playable slide (education), next to the stickers */}
        {configureMeta()}
        {/* Answer key — sits with the stickers because it reads like one: a
            state of the lesson, not another thing to generate. */}
        {answerKeyMeta()}
        {/* best-run meta: the HIGHEST score's level + time, how many times the
            viewer has played it, and a link to replay that best run's
            answers (only once the viewer has played it) */}
        {(completed || tryAgain) && (
          <>
            {lesson.myBestLevel && (
              <span
                title={say("Level of your best attempt")}
                className="micro rounded-wobble-sm border border-pencil bg-paper-2 px-1.5 text-[0.58rem] text-ink-soft"
              >
                {lesson.myBestLevel}
              </span>
            )}
            {lesson.myBestElapsedSec > 0 && (
              <span
                title={say("Time of your best attempt")}
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
          </>
        )}
        {/* the pencil sits with the stickers now — the eye it swapped places
            with lives beside Play, like on the slide cards */}
        {isOwner && lesson.hasPreset && (
          <Link
            to={editHref}
            title={say("Edit this preset's slides — text, questions, answers")}
            aria-label={say("Edit preset")}
            className={cfgChipDashed}
          >
            <Pencil className="h-3 w-3" strokeWidth={2} />
          </Link>
        )}
        {controls && (
          <span className="ml-auto flex items-center gap-1">
            {confirmDelete ? (
              <>
                <span className="micro text-[0.6rem] font-bold text-red">{say("delete?")}</span>
                <button
                  type="button"
                  onClick={() => controls.onDelete(lesson.id)}
                  disabled={controls.deleting}
                  aria-label={say("Confirm delete")}
                  title={say("Confirm delete")}
                  className="rounded-wobble-sm p-1 text-red transition-colors hover:bg-red-soft"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  aria-label={say("Cancel delete")}
                  title={say("Cancel")}
                  className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-paper-2 hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label={say("Delete lesson")}
                title={say("Delete lesson")}
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
            {objectiveLabel}  {say("/ prompt — editing")}
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
              
              {say("Cancel")}
            </SketchButton>
            <SketchButton
              variant="accent"
              size="sm"
              loading={controls.updating}
              onClick={saveObjective}
            >
              <Check className="h-4 w-4" />
              
              {say("Save")}
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
              {objectiveLabel}  {say("/ prompt")}
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
                {lesson.objective.length}  {say("chars")}
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
