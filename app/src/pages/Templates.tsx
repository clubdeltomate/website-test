import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  X,
  Sparkles,
  LayoutTemplate,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import SketchButton from '@/components/sketch/SketchButton';
import Chip from '@/components/sketch/Chip';
import WashiTape from '@/components/sketch/WashiTape';
import StickyNote from '@/components/sketch/StickyNote';
import { Toaster } from '@/components/ui/sonner';
import TemplateBar from '@/components/templates/TemplateBar';
import {
  TEMPLATE_COMPONENT_TYPES,
  TEMPLATE_COMPONENT_LABELS,
  TEMPLATE_LEVELS,
  GRADABLE_TYPES,
  sectionForTags,
  TEMPLATE_FLAVORS,
  type TemplateComponentType,
  type TemplateLevel,
  type TemplateSection,
  type SlideTemplate,
} from '@contracts/slide-templates';
import { TemplateBadges, FlavorBadge } from '@/components/templates/TemplatePicker';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const PAGE_SIZE = 6;

const SECTIONS: { key: TemplateSection; title: string; subtitle: string }[] = [
  { key: 'stem', title: 'STEM layouts', subtitle: 'Offered for math, science, data & technical topics' },
  { key: 'humanities', title: 'Humanities & reading layouts', subtitle: 'Offered for history, language, literature & the arts' },
  { key: 'general', title: 'General layouts', subtitle: 'Offered for every subject' },
];

type LevelFilter = TemplateLevel | 'all';

export default function Templates() {
  const { user, isGuest } = useAuth();
  const utils = trpc.useUtils();
  const list = trpc.templates.list.useQuery();
  const [builderOpen, setBuilderOpen] = useState(false);
  // pre-filled builder seed: edit a custom template (id set) or customize a
  // copy of a built-in (no id → saved as a new custom template)
  const [editing, setEditing] = useState<BuilderSeed | null>(null);

  const templates = list.data ?? [];
  const bySection = useMemo(() => {
    const map: Record<TemplateSection, SlideTemplate[]> = { stem: [], humanities: [], general: [] };
    for (const t of templates) map[sectionForTags(t.tags)].push(t);
    return map;
  }, [templates]);

  const del = trpc.templates.delete.useMutation({
    onSuccess: () => {
      toast.success('Template removed');
      void utils.templates.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const canDelete = (t: SlideTemplate) =>
    !t.builtin &&
    !!user &&
    (t.createdById === user.id || user.role === 'moderator' || user.role === 'admin');

  const openEditor = (t: SlideTemplate) => {
    setEditing({
      id: !t.builtin && canDelete(t) && typeof t.id === 'number' ? t.id : undefined,
      name: t.builtin ? `${t.name} (custom)` : t.name,
      level: t.level,
      components: [...t.components],
      tags: [...t.tags],
    });
    setBuilderOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 lg:px-8">
      <Toaster position="bottom-right" />

      <header className="relative mb-6">
        <h1 className="font-display text-5xl font-bold text-ink">Slide templates</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          These are the slide layouts the AI chooses from when it generates a deck. Each bar is a
          recipe of components in order — <em>Text → Graph → Multiple choice</em> — tagged by subject
          and by CEFR <strong>level</strong>. Lower levels (A0–A2) get lighter layouts; higher
          levels (C1–C2) get denser, multi-paragraph ones. Every layout ends with a gradable step.
        </p>
      </header>

      <StickyNote rotate={-1.5} className="mb-6 max-w-xl">
        <p className="flex items-center gap-1.5 text-[0.95rem]">
          <Sparkles className="h-4 w-4 text-purple" />
          The generator is handed only the layouts that match the lesson's subject <em>and</em> its
          level. Tag a template with <code>#math</code> or <code>#history</code> and set its level so
          it is suggested for the right courses.
        </p>
      </StickyNote>

      {/* subject-badge legend */}
      <div className="mb-6 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3/60 p-4">
        <p className="micro mb-2 font-semibold text-ink-soft">
          Subject badges — a template can carry more than one
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {TEMPLATE_FLAVORS.map((f) => (
            <span key={f.id} className="flex items-center gap-1.5 text-sm text-ink">
              <FlavorBadge id={f.id} />
              <span className="font-heading font-semibold">{f.label}</span>
              <span className="text-[0.7rem] text-ink-faint">— {f.hint}</span>
            </span>
          ))}
        </div>
      </div>

      {!isGuest && (
        <div className="mb-6">
          <SketchButton
            variant="accent"
            onClick={() => {
              if (builderOpen) setEditing(null);
              setBuilderOpen((o) => !o);
            }}
          >
            {builderOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {builderOpen ? 'Close builder' : 'Add a template'}
          </SketchButton>
        </div>
      )}

      <AnimatePresence>
        {builderOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <TemplateBuilder
              key={editing ? `${editing.id ?? 'copy'}-${editing.name}` : 'new'}
              initial={editing}
              onDone={() => {
                setBuilderOpen(false);
                setEditing(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {list.isLoading && <p className="text-ink-faint">Loading templates…</p>}

      {SECTIONS.map((s) => (
        <TemplateSection
          key={s.key}
          title={s.title}
          subtitle={s.subtitle}
          items={bySection[s.key]}
          onDelete={(id) => del.mutate({ id })}
          canDelete={canDelete}
          canCopy={!isGuest}
          onEdit={openEditor}
        />
      ))}
    </div>
  );
}

function TemplateSection({
  title,
  subtitle,
  items,
  onDelete,
  canDelete,
  canCopy,
  onEdit,
}: {
  title: string;
  subtitle: string;
  items: SlideTemplate[];
  onDelete: (id: number) => void;
  canDelete: (t: SlideTemplate) => boolean;
  canCopy: boolean;
  onEdit: (t: SlideTemplate) => void;
}) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter((t) => {
      if (level !== 'all' && t.level !== level) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q)) ||
        t.components.some((c) => TEMPLATE_COMPONENT_LABELS[c].toLowerCase().includes(q))
      );
    });
    return out;
  }, [items, query, level]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (items.length === 0) return null;

  const setLevelReset = (l: LevelFilter) => {
    setLevel(l);
    setPage(0);
  };
  const setQueryReset = (q: string) => {
    setQuery(q);
    setPage(0);
  };

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold text-ink">{title}</h2>
          <p className="micro text-ink-faint">
            {subtitle} · {items.length} layouts
          </p>
        </div>
      </div>

      {/* controls: search + level filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQueryReset(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}…`}
            className="w-full rounded-wobble-sm border-2 border-ink bg-paper-3 py-1.5 pl-8 pr-3 text-sm text-ink shadow-offset outline-none focus:border-blue"
          />
        </div>
        <div className="flex items-center gap-1 rounded-wobble-sm border-2 border-pencil bg-paper-2 p-0.5">
          {(['all', ...TEMPLATE_LEVELS] as LevelFilter[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevelReset(l)}
              className={cn(
                'rounded-wobble-sm px-2.5 py-1 font-heading text-xs font-semibold capitalize transition-colors',
                level === l ? 'border-2 border-ink bg-yellow text-ink shadow-offset' : 'text-ink-soft hover:text-ink',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/50 px-4 py-6 text-center text-sm text-ink-faint">
          No templates match — try another search or level.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((t, i) => (
            <motion.article
              key={String(t.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: EASE, delay: (i % PAGE_SIZE) * 0.03 }}
              className="relative rounded-wobble-2 border-2 border-ink bg-paper-3 p-4 shadow-offset"
            >
              <WashiTape rotate={i % 2 === 0 ? -3 : 2} className="left-6" />
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-heading text-lg font-bold text-ink">
                    <TemplateBadges tags={t.tags} />
                    {t.name}
                  </h3>
                  <Chip
                    kind={t.level}
                    className="mt-0.5 text-[0.58rem] capitalize"
                  >
                    {t.level}
                  </Chip>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {t.builtin ? (
                    <Chip kind="neutral" className="text-[0.6rem]">
                      <LayoutTemplate className="h-3 w-3" /> built-in
                    </Chip>
                  ) : (
                    <Chip kind="slide-tool" className="text-[0.6rem]">
                      {t.createdByName ? `by ${t.createdByName}` : 'custom'}
                    </Chip>
                  )}
                  {t.builtin
                    ? canCopy && (
                        <button
                          type="button"
                          onClick={() => onEdit(t)}
                          aria-label="Copy & edit as a custom template"
                          title="Copy & edit — built-ins can't change, so this opens an editable copy"
                          className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-paper-2 hover:text-ink"
                        >
                          <Copy className="h-4 w-4" strokeWidth={2} />
                        </button>
                      )
                    : canDelete(t) && (
                        <button
                          type="button"
                          onClick={() => onEdit(t)}
                          aria-label="Edit template"
                          title="Edit template"
                          className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-paper-2 hover:text-ink"
                        >
                          <Pencil className="h-4 w-4" strokeWidth={2} />
                        </button>
                      )}
                  {canDelete(t) && typeof t.id === 'number' && (
                    <button
                      type="button"
                      onClick={() => onDelete(t.id as number)}
                      aria-label="Delete template"
                      title="Delete template"
                      className="rounded-wobble-sm p-1 text-ink-faint transition-colors hover:bg-red-soft hover:text-red"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>
              <TemplateBar components={t.components} />
              {t.tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="micro text-[0.6rem] text-ink-faint">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </motion.article>
          ))}
        </div>
      )}

      {/* pagination — max 6 cards per page */}
      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
            className="rounded-wobble-sm border-2 border-ink bg-paper-3 p-1.5 text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="micro font-mono text-ink-soft">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next page"
            className="rounded-wobble-sm border-2 border-ink bg-paper-3 p-1.5 text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
}

interface BuilderSeed {
  id?: number;
  name: string;
  level: TemplateLevel;
  components: TemplateComponentType[];
  tags: string[];
}

function TemplateBuilder({ onDone, initial }: { onDone: () => void; initial?: BuilderSeed | null }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(initial?.name ?? '');
  const [level, setLevel] = useState<TemplateLevel>(initial?.level ?? 'A1');
  const [components, setComponents] = useState<TemplateComponentType[]>(
    initial?.components ?? ['prose', 'quiz'],
  );
  const [tagsRaw, setTagsRaw] = useState(initial?.tags.map((t) => `#${t}`).join(' ') ?? '');

  const create = trpc.templates.create.useMutation({
    onSuccess: () => {
      toast.success('Template added — the generator can use it now ✦');
      void utils.templates.list.invalidate();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.templates.update.useMutation({
    onSuccess: () => {
      toast.success('Template updated ✦');
      void utils.templates.list.invalidate();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const addComponent = (c: TemplateComponentType) => setComponents((cur) => [...cur, c]);
  const removeAt = (idx: number) => setComponents((cur) => cur.filter((_, i) => i !== idx));
  const hasGradable = components.some((c) => GRADABLE_TYPES.includes(c));

  const submit = () => {
    if (name.trim().length < 3) {
      toast.error('Give the template a name (3+ characters)');
      return;
    }
    const readThrough = components.includes('prose') || components.includes('wolfram');
    if (!hasGradable && !readThrough) {
      toast.error('Add a gradable step — or at least a Text/Wolfram step for a read-through');
      return;
    }
    const tags = tagsRaw
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, '').toLowerCase().trim())
      .filter(Boolean);
    if (initial?.id != null) {
      update.mutate({ id: initial.id, name: name.trim(), level, components, tags });
    } else {
      create.mutate({ name: name.trim(), level, components, tags });
    }
  };

  return (
    <div className="mb-6 rounded-wobble-2 border-2 border-dashed border-blue bg-paper p-5 shadow-offset">
      <h2 className="font-heading text-xl font-bold text-ink">
        {initial?.id != null ? 'Edit template' : initial ? 'Customize a copy' : 'New slide template'}
      </h2>
      <p className="micro mb-4 text-ink-faint">
        Order matters — the generator lays out the slide in exactly this sequence. It must end with a
        gradable step.
      </p>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="micro mb-1 block text-ink-soft">Template name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Read the graph"
            className="w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-heading text-ink shadow-offset outline-none focus:border-blue"
          />
        </div>
        <div>
          <label className="micro mb-1 block text-ink-soft">Level</label>
          <div className="flex items-center gap-1 rounded-wobble-sm border-2 border-pencil bg-paper-2 p-0.5">
            {TEMPLATE_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={cn(
                  'flex-1 rounded-wobble-sm px-2 py-1.5 font-heading text-xs font-semibold capitalize transition-colors',
                  level === l ? 'border-2 border-ink bg-yellow text-ink shadow-offset' : 'text-ink-soft hover:text-ink',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="micro mb-1 mt-4 block text-ink-soft">Layout preview</label>
      <div className="mb-2 min-h-[44px] rounded-wobble-sm border-2 border-pencil bg-paper-2 p-2.5">
        {components.length > 0 ? (
          <TemplateBar components={components} />
        ) : (
          <span className="text-sm text-ink-faint">Add components below…</span>
        )}
      </div>
      <div className="mb-1 flex flex-wrap gap-1.5">
        {components.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => removeAt(i)}
            title="Remove"
            className="inline-flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow-soft px-2 py-1 text-[0.72rem] font-semibold text-ink hover:bg-red-soft"
          >
            {TEMPLATE_COMPONENT_LABELS[c]} <X className="h-3 w-3" />
          </button>
        ))}
      </div>
      {!hasGradable && (
        <p className="mb-3 text-xs font-semibold text-red">Add a gradable step so the slide can be scored.</p>
      )}

      <label className="micro mb-1 mt-3 block text-ink-soft">Add component</label>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TEMPLATE_COMPONENT_TYPES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => addComponent(c)}
            className={cn(
              'inline-flex items-center gap-1 rounded-wobble-sm border-2 px-2 py-1 text-[0.72rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-paper-2',
              GRADABLE_TYPES.includes(c) ? 'border-purple bg-purple-soft' : 'border-pencil bg-paper',
            )}
          >
            <Plus className="h-3 w-3" /> {TEMPLATE_COMPONENT_LABELS[c]}
          </button>
        ))}
      </div>

      <label className="micro mb-1 block text-ink-soft">Subject tags (space or comma separated)</label>
      <input
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="#math #statistics  (leave empty for a general layout)"
        className="mb-4 w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-mono text-sm text-ink shadow-offset outline-none focus:border-blue"
      />

      <div className="flex items-center justify-end gap-2">
        <SketchButton variant="ghost" onClick={onDone}>
          Cancel
        </SketchButton>
        <SketchButton variant="accent" loading={create.isPending || update.isPending} onClick={submit}>
          <Plus className="h-4 w-4" />
          {initial?.id != null ? 'Save changes' : 'Save template'}
        </SketchButton>
      </div>
    </div>
  );
}
