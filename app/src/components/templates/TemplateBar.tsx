import { Fragment } from 'react';
import {
  AlignLeft,
  Sigma,
  BarChart3,
  PenTool,
  Table2,
  StickyNote,
  Image as ImageIcon,
  Code2,
  CheckSquare,
  ToggleLeft,
  TextCursorInput,
  Keyboard,
  PencilRuler,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TEMPLATE_COMPONENT_LABELS,
  type TemplateComponentType,
} from '@contracts/slide-templates';

const ICONS: Record<TemplateComponentType, typeof AlignLeft> = {
  prose: AlignLeft,
  latex: Sigma,
  chart: BarChart3,
  svg: PenTool,
  table: Table2,
  stickynote: StickyNote,
  image: ImageIcon,
  code: Code2,
  wolfram: Sigma,
  quiz: CheckSquare,
  mcq2: ToggleLeft,
  fillblank: TextCursorInput,
  shortanswer: Keyboard,
  solve: PencilRuler,
};

const TINT: Record<TemplateComponentType, string> = {
  prose: 'text-ink',
  latex: 'text-purple',
  wolfram: 'text-red',
  chart: 'text-blue',
  svg: 'text-green',
  table: 'text-ink',
  stickynote: 'text-[#b8860b]',
  image: 'text-green',
  code: 'text-blue',
  quiz: 'text-purple',
  mcq2: 'text-purple',
  fillblank: 'text-blue',
  shortanswer: 'text-green',
  solve: 'text-orange',
};

/**
 * The thin "Text → Table → Multiple choice" recipe bar — one pill per
 * component, arrows between them. Mirrors the tool-builder bar the user
 * showed; used both to preview a template and inside the builder.
 */
export default function TemplateBar({
  components,
  className,
}: {
  components: TemplateComponentType[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {components.map((c, i) => {
        const Icon = ICONS[c];
        return (
          <Fragment key={i}>
            <span className="inline-flex items-center gap-1 rounded-wobble-sm border-2 border-pencil bg-paper px-2 py-1 font-heading text-[0.72rem] font-semibold text-ink">
              <Icon className={cn('h-3.5 w-3.5', TINT[c])} strokeWidth={2} />
              {TEMPLATE_COMPONENT_LABELS[c]}
            </span>
            {i < components.length - 1 && (
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
