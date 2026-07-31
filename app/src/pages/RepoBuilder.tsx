import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import { TemplateIcon } from '@/components/repo/shared';
import type { RepoTemplate } from '@contracts/types';
import { getLang, say } from '@/lib/i18n';

interface DraftLesson {
  title: string;
  objective: string;
}
interface DraftUnit {
  title: string;
  lessons: DraftLesson[];
}

const CATEGORIES: { id: RepoTemplate; label: string }[] = [
  { id: 'course', label: 'Course' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'service', label: 'Service' },
  { id: 'shop', label: 'Shop' },
  { id: 'other', label: 'Other' },
];

const inputCls =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue';

const newLesson = (): DraftLesson => ({ title: '', objective: '' });
const newUnit = (): DraftUnit => ({ title: '', lessons: [newLesson()] });

/**
 * Lay out a repository by hand — title, subtitle, category, and a structure of
 * units → lessons with objectives — then publish it as a human-made repo. Add
 * as many units and lessons as you like. No AI is used to build the shell.
 */
export default function RepoBuilder() {
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const utils = trpc.useUtils();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<RepoTemplate>('course');
  const [units, setUnits] = useState<DraftUnit[]>([newUnit()]);
  const [publishing, setPublishing] = useState(false);

  const patchUnit = (ui: number, patch: Partial<DraftUnit>) =>
    setUnits((us) => us.map((u, i) => (i === ui ? { ...u, ...patch } : u)));
  const patchLesson = (ui: number, li: number, patch: Partial<DraftLesson>) =>
    setUnits((us) =>
      us.map((u, i) =>
        i === ui
          ? { ...u, lessons: u.lessons.map((l, j) => (j === li ? { ...l, ...patch } : l)) }
          : u,
      ),
    );
  const addUnit = () => setUnits((us) => [...us, newUnit()]);
  const removeUnit = (ui: number) =>
    setUnits((us) => (us.length > 1 ? us.filter((_, i) => i !== ui) : us));
  const addLesson = (ui: number) =>
    setUnits((us) =>
      us.map((u, i) => (i === ui ? { ...u, lessons: [...u.lessons, newLesson()] } : u)),
    );
  const removeLesson = (ui: number, li: number) =>
    setUnits((us) =>
      us.map((u, i) =>
        i === ui && u.lessons.length > 1
          ? { ...u, lessons: u.lessons.filter((_, j) => j !== li) }
          : u,
      ),
    );

  const publish = async () => {
    if (title.trim().length < 3) {
      toast.error(say("Give the repo a title (at least 3 characters)"));
      return;
    }
    setPublishing(true);
    try {
      const { slug } = await utils.client.repos.create.mutate({
        title: title.trim(),
        description: description.trim(),
        template,
        source: 'human',
        contentLanguage: getLang(),
      });
      for (const u of units) {
        const unitTitle = u.title.trim();
        if (!unitTitle) continue;
        const { unitId } = await utils.client.units.create.mutate({ repoSlug: slug, title: unitTitle });
        for (const l of u.lessons) {
          const lessonTitle = l.title.trim();
          if (!lessonTitle) continue;
          await utils.client.lessons.create.mutate({
            unitId,
            title: lessonTitle,
            objective: l.objective.trim() || lessonTitle,
          });
        }
      }
      await utils.repos.list.invalidate();
      toast.success(say("Repository published ✓"));
      navigate(`/repos/${slug}`);
    } catch (e) {
      toast.error(say(e instanceof Error ? e.message : 'Could not publish'));
      setPublishing(false);
    }
  };

  if (isGuest) {
    return (
      <div className="mx-auto max-w-content px-4 py-10 text-center">
        <p className="text-ink-soft">{say("Sign in to build a repository.")}</p>
        <Link to="/auth" className="mt-3 inline-block font-heading font-bold text-blue underline">
          
          {say("Sign in")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/repos"
          className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />  {say("Repos")}
        </Link>
        <h2 className="font-display text-3xl font-bold text-ink">{say("New repository — by hand")}</h2>
        <span className="micro rounded-full border-2 border-ink bg-green-soft px-2 text-[0.6rem] font-bold text-green">
          
          {say("human-made")}
        </span>
        <SketchButton
          variant="accent"
          size="sm"
          className="ml-auto"
          loading={publishing}
          onClick={publish}
        >
          <Save className="h-4 w-4" />  {say("Publish")}
        </SketchButton>
      </div>

      {/* repo meta */}
      <section className="flex flex-col gap-3 rounded-wobble-2 border-2 border-ink bg-paper-3 p-5 shadow-offset">
        <div>
          <span className="micro mb-1 block text-[0.6rem] uppercase tracking-wider text-ink-faint">{say("Title")}</span>
          <input
            autoFocus
            className={cn(inputCls, 'font-heading text-lg font-bold')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={say("e.g. Introduction to Climate Science")}
          />
        </div>
        <div>
          <span className="micro mb-1 block text-[0.6rem] uppercase tracking-wider text-ink-faint">
            
            {say("Subtitle / description")}
          </span>
          <textarea
            className={cn(inputCls, 'min-h-[56px] resize-y')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={say("A short line about what this repo covers")}
          />
        </div>
        <div>
          <span className="micro mb-1.5 block text-[0.6rem] uppercase tracking-wider text-ink-faint">{say("Category")}</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setTemplate(c.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-wobble-sm border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors',
                  template === c.id
                    ? 'border-ink bg-yellow text-ink shadow-offset'
                    : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                <TemplateIcon template={c.id} className="h-3.5 w-3.5" />
                {say(c.label)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* units + lessons */}
      {units.map((unit, ui) => (
        <section key={ui} className="rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-3/60 p-5 shadow-offset">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper-3 font-display text-sm font-bold text-ink shadow-offset">
              {ui + 1}
            </span>
            <input
              className={cn(inputCls, 'font-heading text-lg font-bold')}
              value={unit.title}
              onChange={(e) => patchUnit(ui, { title: e.target.value })}
              placeholder={`Unit ${ui + 1} title`}
            />
            {units.length > 1 && (
              <button
                type="button"
                onClick={() => removeUnit(ui)}
                title={say("Remove unit")}
                aria-label={say("Remove unit")}
                className="rounded-wobble-sm border-2 border-transparent p-1.5 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 border-l-2 border-dashed border-pencil pl-4">
            {unit.lessons.map((lesson, li) => (
              <div key={li} className="relative rounded-wobble-sm border-2 border-dotted border-pencil bg-paper p-3">
                {unit.lessons.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLesson(ui, li)}
                    title={say("Remove lesson")}
                    aria-label={say("Remove lesson")}
                    className="absolute right-2 top-2 rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                )}
                <span className="micro mb-1 block text-[0.58rem] uppercase tracking-wider text-ink-faint">
                  
                  {say("Lesson")} {ui + 1}.{li + 1}
                </span>
                <input
                  className={cn(inputCls, 'mb-2 font-heading font-semibold')}
                  value={lesson.title}
                  onChange={(e) => patchLesson(ui, li, { title: e.target.value })}
                  placeholder={say("Lesson title")}
                />
                <textarea
                  className={cn(inputCls, 'min-h-[56px] resize-y font-mono text-[0.8rem]')}
                  value={lesson.objective}
                  onChange={(e) => patchLesson(ui, li, { objective: e.target.value })}
                  placeholder={say("Objective / prompt — what should this lesson teach or show?")}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => addLesson(ui)}
              className="micro flex items-center justify-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.62rem] font-semibold text-ink-soft hover:border-ink hover:text-ink"
            >
              <Plus className="h-3 w-3" />  {say("Add lesson")}
            </button>
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={addUnit}
        className="flex items-center justify-center gap-1.5 rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-2/40 px-3 py-3 font-heading font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />  {say("Add unit")}
      </button>

      <div className="flex justify-end">
        <SketchButton variant="accent" loading={publishing} onClick={publish}>
          <Save className="h-4 w-4" />  {say("Publish repository")}
        </SketchButton>
      </div>
    </div>
  );
}
