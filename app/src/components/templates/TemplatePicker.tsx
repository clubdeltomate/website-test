import { Fragment, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  flavorsForTags,
  sectionForTags,
  TEMPLATE_COMPONENT_SHORT,
  TEMPLATE_FLAVORS,
  TEMPLATE_SECTION_LABEL,
  GRADABLE_TYPES,
  type SlideTemplate,
  type TemplateComponentType,
  type TemplateFlavor,
  type TemplateSection,
} from '@contracts/slide-templates';

/** Render a template's content sequence, colouring the Image step brown so
 *  slides that carry a picture stand out. */
function SequenceLabel({ components }: { components: TemplateComponentType[] }) {
  return (
    <>
      {' — '}
      {components.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <span className={c === 'image' ? 'font-bold text-[#8a5a2b]' : undefined}>
            {TEMPLATE_COMPONENT_SHORT[c] ?? c}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/** Colour per subject flavour (the legend uses the same map). */
export const FLAVOR_STYLE: Record<TemplateFlavor, string> = {
  math: 'border-red bg-red-soft text-red',
  wolfram: 'border-red bg-paper-2 text-red',
  code: 'border-blue bg-blue-soft text-blue',
  medicine: 'border-green bg-green-soft text-green',
  finance: 'border-orange bg-yellow-soft text-orange',
  philosophy: 'border-purple bg-purple-soft text-purple',
};

/** One coloured subject glyph. */
export function FlavorBadge({ id }: { id: TemplateFlavor }) {
  const f = TEMPLATE_FLAVORS.find((x) => x.id === id)!;
  return (
    <span
      title={f.label}
      className={cn(
        'mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full border align-[-1px] font-display text-[0.7rem] font-bold leading-none',
        FLAVOR_STYLE[id],
      )}
    >
      {f.symbol}
    </span>
  );
}

/** All the subject badges a template qualifies for (may be several). */
export function TemplateBadges({ tags }: { tags: string[] }) {
  const flavors = flavorsForTags(tags);
  if (flavors.length === 0) return null;
  return (
    <>
      {flavors.map((id) => (
        <FlavorBadge key={id} id={id} />
      ))}
    </>
  );
}

/** Category colour so the section reads at a glance in the picker. */
const SECTION_COLOR: Record<TemplateSection, string> = {
  stem: 'text-blue',
  humanities: 'text-orange',
  general: 'text-green',
};

/** The coloured "· STEM" / "· Humanities" / "· General" tag for a template. */
function SectionTag({ t }: { t: SlideTemplate }) {
  const section = sectionForTags(t.tags);
  return (
    <span className={cn('font-bold', SECTION_COLOR[section])}>
      {TEMPLATE_SECTION_LABEL[section]}
    </span>
  );
}

/** Full option label: [π] name ● · <coloured section> (level) — Text · Table · …
 *  The green dot marks evaluation-free templates (no quiz/solve step). */
function OptionLabel({ t, withSequence }: { t: SlideTemplate; withSequence: boolean }) {
  const evalFree = !t.components.some((c) => GRADABLE_TYPES.includes(c));
  return (
    <>
      <TemplateBadges tags={t.tags} />
      {t.name}
      {evalFree && (
        <span
          title="No evaluation — read-through slide"
          aria-label="No evaluation"
          className="mx-1 inline-block h-2 w-2 rounded-full border border-ink bg-green align-middle"
        />
      )}{' '}
      · <SectionTag t={t} />
      {t.tags.includes('wolfram') && (
        <>
          {' '}· <span className="font-bold text-red">W⍺ Wolfram</span>
        </>
      )}{' '}
      ({t.level})
      {withSequence && <SequenceLabel components={t.components} />}
    </>
  );
}

/**
 * A per-slide layout picker. Replaces the native <select> so the subject
 * section (STEM/Humanities/General) can be colour-coded — native <option>
 * text can't be styled per word.
 *
 * The list expands IN FLOW (it pushes the content below it down) rather than
 * floating over the page, so it is never clipped or overlapped, moves
 * naturally with the page, and — marked data-lenis-prevent — scrolls its own
 * list on the mouse wheel instead of scrolling the whole page.
 */
export default function TemplatePicker({
  value,
  templates,
  selectedTemplate,
  onChange,
}: {
  /** selected template name, or '' for Auto */
  value: string;
  templates: SlideTemplate[];
  /** the resolved selected template (may be outside `templates`, e.g. a
   *  packet slide from another level) — used for the button display */
  selectedTemplate?: SlideTemplate | null;
  onChange: (name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value
    ? (selectedTemplate ?? templates.find((t) => t.name === value))
    : undefined;

  const pick = (name: string | null) => {
    onChange(name);
    setOpen(false);
  };

  const optionClasses = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2 whitespace-nowrap rounded-wobble-sm px-2.5 py-1.5 text-left font-heading text-sm text-ink hover:bg-paper-2',
      active && 'bg-paper-2',
    );

  return (
    // fixed width so every slide's picker lines up (the recipe bar flows after)
    <div ref={ref} className="w-full sm:w-[340px] sm:shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between gap-2 border-2 border-ink bg-paper px-2 py-1 text-left font-heading text-sm text-ink outline-none focus:border-blue',
          open ? 'rounded-t-wobble-sm border-b-transparent' : 'rounded-wobble-sm',
        )}
      >
        <span className="truncate">
          {selected ? (
            <OptionLabel t={selected} withSequence={false} />
          ) : value ? (
            // pinned to a template not in this filtered list (e.g. a packet)
            value
          ) : (
            'Auto (AI chooses)'
          )}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-ink-soft transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ul
              role="listbox"
              data-lenis-prevent
              className="max-h-64 overflow-y-auto rounded-b-wobble-sm border-2 border-t-0 border-ink bg-paper-3 p-1 shadow-offset"
            >
              <li role="option" aria-selected={!value}>
                <button type="button" onClick={() => pick(null)} className={optionClasses(!value)}>
                  <Check className={cn('h-3.5 w-3.5 shrink-0', !value ? 'text-ink' : 'opacity-0')} />
                  Auto (AI chooses)
                </button>
              </li>
              {templates.map((t) => (
                <li key={String(t.id)} role="option" aria-selected={value === t.name}>
                  <button
                    type="button"
                    onClick={() => pick(t.name)}
                    className={optionClasses(value === t.name)}
                  >
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        value === t.name ? 'text-ink' : 'opacity-0',
                      )}
                    />
                    <span>
                      <OptionLabel t={t} withSequence />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
