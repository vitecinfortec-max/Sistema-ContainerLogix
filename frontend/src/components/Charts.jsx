import { useId, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AnimatedNumber } from './Motion';
import { cn } from '../lib/utils';

// Gráficos do sistema (recharts) com um visual só: barras em degradê com topo
// arredondado que crescem ao entrar, legenda com o total do período, tooltip
// com o valor formatado e o total do dia. As telas de relatório e o Dashboard
// usam o que está aqui - um ajuste de estilo feito aqui vale pra todas.

export const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  amber: '#f59e0b',
  emerald: '#10b981',
  slate: '#94a3b8',
};

export const fmtChartInt = (v) => Number(v || 0).toLocaleString('pt-BR');

const compactFormat = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const fmtAxis = (v) => compactFormat.format(Number(v) || 0);

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pontos diários da API ({ date: 'aaaa-mm-dd', ... }) prontos pro gráfico. */
export function dailyChartData(points) {
  return (points || []).map((d) => {
    const day = new Date(`${d.date}T00:00:00`);
    return {
      ...d,
      label: format(day, 'dd/MM', { locale: ptBR }),
      fullLabel: capitalize(format(day, "EEEE, dd 'de' MMMM", { locale: ptBR })),
    };
  });
}

export function ChartTooltip({ active, payload, label, valueFormat = fmtChartInt, colors = {}, showTotal = true }) {
  if (!active || !payload || !payload.length) return null;
  const title = payload[0]?.payload?.fullLabel || label;
  const total = payload.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
  return (
    <div className="min-w-[160px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm shadow-[0_10px_28px_-10px_rgba(15,23,42,0.35)] px-3 py-2 text-xs">
      {title && <p className="font-semibold text-slate-800 dark:text-slate-100 mb-1.5">{title}</p>}
      {payload.map((entry) => (
        <div key={entry.dataKey || entry.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-[3px]" style={{ background: colors[entry.dataKey] || entry.payload?.color || entry.color }} />
            {entry.name}
          </span>
          <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{valueFormat(entry.value)}</span>
        </div>
      ))}
      {showTotal && payload.length > 1 && (
        <div className="flex items-center justify-between gap-4 mt-1 pt-1 border-t border-slate-100 dark:border-slate-800">
          <span className="text-slate-500 dark:text-slate-400">Total</span>
          <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{valueFormat(total)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Gráfico de barras. `series`: [{ key, name, color }]. `valueFormat` formata
 * os valores do tooltip e da legenda (ex.: moeda); o eixo usa a forma curta
 * ("1,2 mil"). A legenda mostra o total de cada série no período exibido.
 */
export function BarsChart({
  data, series, xKey = 'label', valueFormat = fmtChartInt, allowDecimals = false,
  maxBarSize = 28, className = 'h-72', testId,
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const colors = useMemo(() => Object.fromEntries(series.map((s) => [s.key, s.color])), [series]);
  const totals = useMemo(
    () => Object.fromEntries(series.map((s) => [s.key, (data || []).reduce((sum, d) => sum + (Number(d[s.key]) || 0), 0)])),
    [data, series],
  );

  return (
    <div data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.name}
            <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              <AnimatedNumber value={valueFormat(totals[s.key])} />
            </span>
          </span>
        ))}
      </div>
      <div className={cn('w-full', className)}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 6, left: -8, bottom: 0 }} barGap={3}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`${uid}-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0.5 }} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 4" className="stroke-slate-200/80 dark:stroke-slate-800" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickMargin={8} />
            <YAxis allowDecimals={allowDecimals} tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} />
            <Tooltip
              content={<ChartTooltip valueFormat={valueFormat} colors={colors} />}
              cursor={{ fill: 'rgba(148, 163, 184, 0.14)', radius: 6 }}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={`url(#${uid}-bar-${i})`}
                radius={[5, 5, 0, 0]}
                maxBarSize={maxBarSize}
                animationBegin={120 + i * 140}
                animationDuration={750}
                animationEasing="ease-out"
                activeBar={{ fill: s.color, stroke: s.color, strokeOpacity: 0.22, strokeWidth: 4 }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Rosca com o total no centro. Fatias zeradas ficam de fora (sem a "fresta"
 * que uma fatia vazia deixava). `data`: [{ name, value, color }].
 */
export function DonutChart({ data, centerLabel = 'Total', className = 'h-52', testId }) {
  const slices = (data || []).filter((d) => Number(d.value) > 0);
  const total = slices.reduce((sum, d) => sum + Number(d.value), 0);
  const many = slices.length > 1;
  return (
    <div className={cn('relative w-full', className)} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="92%"
            startAngle={90}
            endAngle={-270}
            paddingAngle={many ? 3 : 0}
            cornerRadius={many ? 6 : 0}
            stroke="none"
            animationBegin={150}
            animationDuration={900}
            animationEasing="ease-out"
          >
            {slices.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={<ChartTooltip showTotal={false} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none tabular-nums text-slate-800 dark:text-slate-100"><AnimatedNumber value={total} /></span>
        <span className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{centerLabel}</span>
      </div>
    </div>
  );
}

/** Minigráfico de área (sem eixos) pra mostrar a tendência dentro de um card. */
export function Sparkline({ data, dataKey, name, color = CHART_COLORS.primary, className = 'h-12 w-32' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (!data || data.length < 2) return null;
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={`${uid}-spark`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.4 }} />
              <stop offset="100%" style={{ stopColor: color, stopOpacity: 0.03 }} />
            </linearGradient>
          </defs>
          <Tooltip
            content={<ChartTooltip showTotal={false} colors={{ [dataKey]: color }} />}
            cursor={{ stroke: color, strokeOpacity: 0.3 }}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 30 }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={name}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${uid}-spark)`}
            fillOpacity={1}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: color }}
            animationBegin={250}
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
