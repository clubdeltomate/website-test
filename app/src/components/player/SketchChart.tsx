import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

const FILLS = ['#FFC53D', '#3F74D6', '#4C9A5C'];
const INK = '#2E2820';

export interface SketchChartProps {
  chartType: 'bar' | 'line' | 'pie' | 'area';
  labels: string[];
  series: { name: string; data: number[] }[];
}

/** 45° hatch patterns over the brand fills (design.md §5.7) */
function HatchDefs() {
  return (
    <defs>
      {FILLS.map((c, i) => (
        <pattern
          key={c}
          id={`sketch-hatch-${i}`}
          width="7"
          height="7"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="7" height="7" fill={c} />
          <line x1="0" y1="0" x2="0" y2="7" stroke={INK} strokeWidth="1.1" opacity="0.28" />
        </pattern>
      ))}
    </defs>
  );
}

const axisTick = { fontFamily: 'Caveat, cursive', fontSize: 17, fill: INK };
const axisLine = { stroke: INK, strokeWidth: 2 };

/** Hand-drawn tooltip (sticky-note mini) */
function SketchTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-wobble-sm border-2 border-ink bg-yellow-soft px-3 py-1.5 font-heading text-sm shadow-offset">
      <p className="font-bold">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-mono text-xs">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

/**
 * Sketch-styled chart (design.md §5.7): ink axes, yellow/blue/green fills
 * with 45° hatch overlays, Caveat labels, hand-drawn legend chips.
 */
export default function SketchChart({ chartType, labels, series }: SketchChartProps) {
  const rows = labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    for (const s of series) row[s.name] = s.data[i] ?? 0;
    return row;
  });

  const legend = (
    <div className="mt-2 flex flex-wrap justify-center gap-2">
      {series.map((s, i) => (
        <span
          key={s.name}
          className="inline-flex items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-ink bg-paper-3 px-2 py-0.5 font-heading text-xs"
        >
          <span
            className="inline-block h-3 w-3 rounded-sm border border-ink"
            style={{ backgroundColor: FILLS[i % FILLS.length] }}
          />
          {s.name}
        </span>
      ))}
    </div>
  );

  if (chartType === 'pie') {
    const pieData = labels.map((label, i) => ({
      name: label,
      value: series[0]?.data[i] ?? 0,
    }));
    return (
      <div>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <HatchDefs />
            <Tooltip content={<SketchTooltip />} />
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={0}
              outerRadius={95}
              stroke={INK}
              strokeWidth={2}
              label={(props: { name?: string }) => props.name ?? ''}
              style={{ fontFamily: 'Caveat, cursive', fontSize: 16, fill: INK }}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={`url(#sketch-hatch-${i % FILLS.length})`} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {legend}
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        {chartType === 'bar' ? (
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <HatchDefs />
            <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 5" vertical={false} />
            <XAxis dataKey="name" tick={axisTick} axisLine={axisLine} tickLine={false} />
            <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} />
            <Tooltip content={<SketchTooltip />} cursor={{ fill: 'rgba(255,233,174,.35)' }} />
            {series.map((s, i) => (
              <Bar
                key={s.name}
                dataKey={s.name}
                fill={`url(#sketch-hatch-${i % FILLS.length})`}
                stroke={INK}
                strokeWidth={2}
                radius={[6, 6, 0, 0]}
              />
            ))}
          </BarChart>
        ) : chartType === 'area' ? (
          <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <HatchDefs />
            <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 5" vertical={false} />
            <XAxis dataKey="name" tick={axisTick} axisLine={axisLine} tickLine={false} />
            <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} />
            <Tooltip content={<SketchTooltip />} />
            {series.map((s, i) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={FILLS[i % FILLS.length]}
                strokeWidth={3}
                fill={`url(#sketch-hatch-${i % FILLS.length})`}
                fillOpacity={0.75}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <HatchDefs />
            <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 5" vertical={false} />
            <XAxis dataKey="name" tick={axisTick} axisLine={axisLine} tickLine={false} />
            <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} />
            <Tooltip content={<SketchTooltip />} />
            {series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={FILLS[i % FILLS.length]}
                strokeWidth={3.5}
                dot={{ r: 4, fill: FILLS[i % FILLS.length], stroke: INK, strokeWidth: 1.5 }}
                activeDot={{ r: 6, stroke: INK, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
      {legend}
    </div>
  );
}
