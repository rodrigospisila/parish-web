import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import './Charts.css';

/**
 * Gráficos do painel em SVG/HTML puro (sem biblioteca): linha com área,
 * colunas empilhadas, barras horizontais, sparkline, medidor e o cartão que
 * os envolve (título, legenda e visão em tabela — o "gêmeo acessível" de
 * cada gráfico). Cores das séries vêm de fora; texto usa sempre os tokens.
 */

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  /** Ícone da legenda (status nunca depende só da cor) */
  icon?: string;
}

export const CHART = {
  series: '#2a78d6',
  seriesSoft: '#cde2fb',
  good: '#238a52',
  warn: '#e6a117',
  critical: '#c53b42',
  muted: '#b7c0c9',
  grid: '#e6ebf0',
  axis: '#c9d2db',
  text: '#52606d',
  textMuted: '#7b8794',
  ink: '#151a20',
  surface: '#ffffff',
};

/** Rampa ordinal azul (validada): etapas em ordem, do claro ao escuro */
export const ORDINAL_BLUES = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];

const numberFormat = new Intl.NumberFormat('pt-BR');
export const fmtInt = (value: number) => numberFormat.format(value);

const useMeasure = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
};

/** Teto "redondo" do eixo (1, 2, 5 × 10^k), nunca abaixo de 4 */
const niceMax = (max: number): number => {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
};

/** Ticks inteiros e redondos: 4 intervalos para tetos 2×10^k (e 4), 5 para 1×/5×10^k */
const ticksFor = (max: number): number[] => {
  const lead = max / 10 ** Math.floor(Math.log10(Math.max(1, max)));
  const count = lead === 2 || lead === 4 ? 4 : 5;
  return Array.from({ length: count + 1 }, (_, i) => Math.round((max / count) * i));
};

/** Retângulo com só o topo arredondado (a base fica reta na linha-base) */
const topRoundedRect = (x: number, y: number, w: number, h: number, r: number): string => {
  if (h <= 0 || w <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${x + w - radius}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
};

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export interface TipRow {
  label: string;
  value: string;
  color?: string;
}

interface TipState {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

const Tooltip: React.FC<{ tip: TipState | null; width: number }> = ({ tip, width }) => {
  if (!tip) return null;
  const flip = width > 0 && tip.x > width * 0.62;
  return (
    <div
      className={`chart-tip${flip ? ' chart-tip--left' : ''}`}
      style={{ left: tip.x, top: tip.y }}
      role="status"
    >
      <div className="chart-tip__title">{tip.title}</div>
      {tip.rows.map((row) => (
        <div key={row.label} className="chart-tip__row">
          {row.color && <span className="chart-tip__key" style={{ background: row.color }} />}
          <span className="chart-tip__value">{row.value}</span>
          <span className="chart-tip__label">{row.label}</span>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Cartão + legenda + tabela
// ---------------------------------------------------------------------------

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  legend?: ChartSeries[];
  table?: ChartTable;
  /** Mensagem de vazio; quando presente substitui o gráfico */
  empty?: string | null;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const ChartCard: React.FC<ChartCardProps> = ({ title, subtitle, legend, table, empty, action, className, children }) => {
  const [tableMode, setTableMode] = useState(false);
  return (
    <section className={`chart-card${className ? ` ${className}` : ''}`}>
      <header className="chart-card__head">
        <div className="chart-card__titles">
          <h3 className="chart-card__title">{title}</h3>
          {subtitle && <p className="chart-card__subtitle">{subtitle}</p>}
        </div>
        <div className="chart-card__actions">
          {action}
          {table && !empty && (
            <button
              type="button"
              className={`chart-card__toggle${tableMode ? ' is-on' : ''}`}
              onClick={() => setTableMode((v) => !v)}
              aria-pressed={tableMode}
            >
              {tableMode ? 'Gráfico' : 'Tabela'}
            </button>
          )}
        </div>
      </header>
      <div className="chart-card__body">
        {empty ? (
          <p className="chart-empty">{empty}</p>
        ) : tableMode && table ? (
          <div className="chart-table-wrap">
            <table className="chart-table">
              <thead>
                <tr>
                  {table.columns.map((column, index) => (
                    <th key={column} className={index > 0 ? 'is-num' : undefined}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={cellIndex > 0 ? 'is-num' : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
      {legend && legend.length > 1 && !empty && (
        <ul className="chart-legend" aria-label="Legenda">
          {legend.map((series) => (
            <li key={series.key} className="chart-legend__item">
              <span className="chart-legend__swatch" style={{ background: series.color }} aria-hidden="true" />
              {series.icon && <span className="chart-legend__icon" aria-hidden="true">{series.icon}</span>}
              <span>{series.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Linha com área (tendência de uma série)
// ---------------------------------------------------------------------------

export interface LinePoint {
  label: string;
  value: number | null;
  details?: TipRow[];
}

interface LineAreaChartProps {
  points: LinePoint[];
  /** Teto fixo do eixo (ex.: 100 para percentual); sem ele, calcula um teto redondo */
  max?: number;
  unit?: string;
  height?: number;
  color?: string;
  ariaLabel: string;
  /** Marca o último ponto e escreve o valor ao lado dele */
  emphasizeLast?: boolean;
}

export const LineAreaChart: React.FC<LineAreaChartProps> = ({
  points,
  max,
  unit = '',
  height = 220,
  color = CHART.series,
  ariaLabel,
  emphasizeLast = true,
}) => {
  const { ref, width } = useMeasure();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();

  const pad = { top: 18, right: 44, bottom: 30, left: 40 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const yMax = max ?? niceMax(Math.max(0, ...values));
  const ticks = max === 100 ? [0, 25, 50, 75, 100] : ticksFor(yMax);
  const n = points.length;
  const xOf = (i: number) => pad.left + (n > 1 ? (innerW * i) / (n - 1) : innerW / 2);
  const yOf = (v: number) => pad.top + innerH - (Math.min(v, yMax) / yMax) * innerH;

  // Segmentos contínuos (um ponto sem valor quebra a linha)
  const segments = useMemo(() => {
    const result: number[][] = [];
    let current: number[] = [];
    points.forEach((p, i) => {
      if (p.value === null) {
        if (current.length) result.push(current);
        current = [];
      } else {
        current.push(i);
      }
    });
    if (current.length) result.push(current);
    return result;
  }, [points]);

  const lastIndex = (() => {
    for (let i = n - 1; i >= 0; i -= 1) if (points[i].value !== null) return i;
    return -1;
  })();

  const pick = (clientX: number, rect: DOMRect) => {
    if (n === 0) return;
    const x = clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = Math.abs(xOf(i) - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setActive(best);
  };

  const tip: TipState | null =
    active !== null && width > 0
      ? {
          x: xOf(active),
          y: pad.top,
          title: points[active].label,
          rows: [
            {
              label: 'no período',
              value: points[active].value === null ? 'sem dados' : `${fmtInt(points[active].value as number)}${unit}`,
              color,
            },
            ...(points[active].details ?? []),
          ],
        }
      : null;

  return (
    <div className="chart chart--line" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerMove={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
            if (event.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
            if (event.key === 'Escape') setActive(null);
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.16" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={yOf(tick)} y2={yOf(tick)} stroke={CHART.grid} strokeWidth="1" />
              <text x={pad.left - 8} y={yOf(tick) + 4} textAnchor="end" className="chart-axis-text">
                {fmtInt(tick)}
                {unit}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            n <= 10 || i % 2 === 0 ? (
              <text key={p.label + i} x={xOf(i)} y={height - 8} textAnchor="middle" className="chart-axis-text">
                {p.label}
              </text>
            ) : null,
          )}
          {segments.map((segment) => {
            const line = segment.map((i, k) => `${k === 0 ? 'M' : 'L'}${xOf(i)},${yOf(points[i].value as number)}`).join(' ');
            const first = segment[0];
            const last = segment[segment.length - 1];
            const area = `${line} L${xOf(last)},${yOf(0)} L${xOf(first)},${yOf(0)} Z`;
            return (
              <g key={segment.join('-')}>
                <path d={area} fill={`url(#${gradientId})`} />
                <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {active !== null && (
            <line x1={xOf(active)} x2={xOf(active)} y1={pad.top} y2={pad.top + innerH} stroke={CHART.axis} strokeWidth="1" />
          )}
          {points.map((p, i) =>
            p.value === null ? null : (
              <circle
                key={`m${i}`}
                cx={xOf(i)}
                cy={yOf(p.value)}
                r={i === lastIndex && emphasizeLast ? 5 : active === i ? 5 : 3.5}
                fill={color}
                stroke={CHART.surface}
                strokeWidth="2"
              />
            ),
          )}
          {emphasizeLast && lastIndex >= 0 && (
            <text
              x={xOf(lastIndex) + 9}
              y={yOf(points[lastIndex].value as number) + 4}
              className="chart-direct-label"
            >
              {fmtInt(points[lastIndex].value as number)}
              {unit}
            </text>
          )}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Colunas empilhadas (uma coluna por período)
// ---------------------------------------------------------------------------

export interface ColumnGroup {
  label: string;
  values: Record<string, number>;
  /** Período em destaque (ex.: semana atual) */
  highlight?: boolean;
  /** Linha extra no tooltip (ex.: "3 escalas") */
  note?: string;
}

interface StackedColumnsProps {
  groups: ColumnGroup[];
  series: ChartSeries[];
  height?: number;
  ariaLabel: string;
}

export const StackedColumns: React.FC<StackedColumnsProps> = ({ groups, series, height = 220, ariaLabel }) => {
  const { ref, width } = useMeasure();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 14, right: 12, bottom: 30, left: 36 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const totals = groups.map((g) => series.reduce((acc, s) => acc + (g.values[s.key] ?? 0), 0));
  const yMax = niceMax(Math.max(0, ...totals));
  const ticks = ticksFor(yMax);
  const n = groups.length;
  const band = n > 0 ? innerW / n : 0;
  const barW = Math.min(24, Math.max(6, band * 0.55));
  const yOf = (v: number) => pad.top + innerH - (v / yMax) * innerH;

  const tip: TipState | null =
    active !== null && width > 0
      ? {
          x: pad.left + band * active + band / 2,
          y: pad.top,
          title: groups[active].label,
          rows: [
            ...series
              .slice()
              .reverse()
              .map((s) => ({ label: s.label, value: fmtInt(groups[active].values[s.key] ?? 0), color: s.color })),
            { label: 'total', value: fmtInt(totals[active]) },
            ...(groups[active].note ? [{ label: '', value: groups[active].note as string }] : []),
          ],
        }
      : null;

  return (
    <div className="chart chart--columns" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
            if (event.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
            if (event.key === 'Escape') setActive(null);
          }}
        >
          {groups.map((g, i) =>
            g.highlight ? (
              <rect
                key={`h${i}`}
                x={pad.left + band * i}
                y={pad.top - 6}
                width={band}
                height={innerH + 6}
                fill="#eaf4ff"
                rx="6"
              />
            ) : null,
          )}
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={yOf(tick)} y2={yOf(tick)} stroke={CHART.grid} strokeWidth="1" />
              <text x={pad.left - 8} y={yOf(tick) + 4} textAnchor="end" className="chart-axis-text">
                {fmtInt(tick)}
              </text>
            </g>
          ))}
          {groups.map((g, i) => {
            const x = pad.left + band * i + (band - barW) / 2;
            let cursor = 0;
            const segs = series.map((s, k) => {
              const v = g.values[s.key] ?? 0;
              const yBottom = yOf(cursor);
              const yTop = yOf(cursor + v);
              cursor += v;
              const isTop = series.slice(k + 1).every((other) => (g.values[other.key] ?? 0) === 0);
              const h = yBottom - yTop;
              // 2px de superfície entre segmentos: encolhe o topo de cada fatia
              const drawH = Math.max(0, h - (isTop ? 0 : 2));
              return { key: s.key, color: s.color, yTop, drawH, isTop, v };
            });
            const dim = active !== null && active !== i;
            return (
              <g key={g.label + i} opacity={dim ? 0.55 : 1}>
                {segs.map((seg) =>
                  seg.v <= 0 ? null : seg.isTop ? (
                    <path key={seg.key} d={topRoundedRect(x, seg.yTop, barW, seg.drawH, 4)} fill={seg.color} />
                  ) : (
                    <rect key={seg.key} x={x} y={seg.yTop + 2} width={barW} height={seg.drawH} fill={seg.color} />
                  ),
                )}
                <text
                  x={pad.left + band * i + band / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className={`chart-axis-text${g.highlight ? ' is-strong' : ''}`}
                >
                  {g.label}
                </text>
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerMove={() => setActive(i)}
                />
              </g>
            );
          })}
          <line x1={pad.left} x2={width - pad.right} y1={yOf(0)} y2={yOf(0)} stroke={CHART.axis} strokeWidth="1" />
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Barras horizontais (uma ou várias séries por linha)
// ---------------------------------------------------------------------------

export interface HBarRow {
  label: string;
  sub?: string;
  values: Record<string, number>;
  /** Limite da própria linha (ex.: vagas da turma): a trilha vira o "cheio" */
  max?: number | null;
  /** Texto à direita; sem ele mostra o total */
  valueText?: string;
  /** Cor por linha (rampa ordinal) quando há uma única série */
  color?: string;
}

interface HBarsProps {
  rows: HBarRow[];
  series: ChartSeries[];
  ariaLabel: string;
}

export const HBars: React.FC<HBarsProps> = ({ rows, series, ariaLabel }) => {
  const { ref, width } = useMeasure();
  const [tip, setTip] = useState<TipState | null>(null);
  const totals = rows.map((r) => series.reduce((acc, s) => acc + (r.values[s.key] ?? 0), 0));
  const sharedMax = Math.max(1, ...totals, ...rows.map((r) => r.max ?? 0));

  // Mesmo tooltip no hover e no foco de teclado
  const showTip = (element: HTMLElement, row: HBarRow, total: number) => {
    const rect = element.getBoundingClientRect();
    const host = ref.current?.getBoundingClientRect();
    setTip({
      x: Math.min(rect.left - (host?.left ?? 0) + rect.width * 0.4, width - 20),
      y: rect.top - (host?.top ?? 0),
      title: row.label,
      rows: [
        ...(series.length > 1 ? series.map((s) => ({ label: s.label, value: fmtInt(row.values[s.key] ?? 0), color: s.color })) : []),
        { label: row.max ? `de ${fmtInt(row.max)} vagas` : 'total', value: fmtInt(total) },
        ...(row.sub ? [{ label: '', value: row.sub }] : []),
      ],
    });
  };

  return (
    <div className="chart chart--hbars" ref={ref}>
      <ul className="hbar-list" aria-label={ariaLabel}>
        {rows.map((row, i) => {
          const scale = row.max ? row.max : sharedMax;
          const total = totals[i];
          const valueText = row.valueText ?? fmtInt(total);
          return (
            <li
              key={row.label + i}
              className="hbar"
              tabIndex={0}
              aria-label={`${row.label}: ${valueText}${row.sub ? ` (${row.sub})` : ''}`}
              onPointerEnter={(event) => showTip(event.currentTarget, row, total)}
              onPointerLeave={() => setTip(null)}
              onFocus={(event) => showTip(event.currentTarget, row, total)}
              onBlur={() => setTip(null)}
            >
              <div className="hbar__label" title={row.label} aria-hidden="true">
                <span className="hbar__name">{row.label}</span>
                {row.sub && <span className="hbar__sub">{row.sub}</span>}
              </div>
              <div className={`hbar__track${row.max ? ' hbar__track--bounded' : ''}`} aria-hidden="true">
                {series.map((s) => {
                  const v = row.values[s.key] ?? 0;
                  if (v <= 0) return null;
                  return (
                    <span
                      key={s.key}
                      className="hbar__seg"
                      style={{ width: `${Math.min(100, (v / scale) * 100)}%`, background: row.color ?? s.color }}
                    />
                  );
                })}
              </div>
              <div className="hbar__value" aria-hidden="true">
                {valueText}
              </div>
            </li>
          );
        })}
      </ul>
      <Tooltip tip={tip} width={width} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sparkline e medidor (para os cartões de indicador)
// ---------------------------------------------------------------------------

export const Sparkline: React.FC<{ values: (number | null)[]; color?: string; width?: number; height?: number }> = ({
  values,
  color = CHART.series,
  width = 104,
  height = 30,
}) => {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return null;
  const max = Math.max(1, ...valid);
  const min = Math.min(0, ...valid);
  const n = values.length;
  const x = (i: number) => 3 + ((width - 6) * i) / (n - 1);
  const y = (v: number) => 3 + (height - 6) - ((v - min) / (max - min || 1)) * (height - 6);
  const pts = values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`));
  const path = pts
    .map((p, i) => (p === null ? '' : `${i === 0 || pts[i - 1] === null ? 'M' : 'L'}${p}`))
    .join(' ');
  let last = -1;
  for (let i = n - 1; i >= 0; i -= 1) if (values[i] !== null) { last = i; break; }
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <path d={path} fill="none" stroke={CHART.muted} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {last >= 0 && <circle cx={x(last)} cy={y(values[last] as number)} r="4" fill={color} stroke={CHART.surface} strokeWidth="2" />}
    </svg>
  );
};

export const Meter: React.FC<{ value: number | null; color?: string; label?: string }> = ({ value, color = CHART.series, label }) => (
  <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-label={label}>
    <span className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
  </div>
);

// ---------------------------------------------------------------------------
// Cartão de indicador (stat tile)
// ---------------------------------------------------------------------------

interface StatTileProps {
  label: string;
  value: string;
  /** Texto do delta; `tone` diz se a direção é boa ou ruim */
  delta?: { text: string; tone: 'good' | 'bad' | 'neutral' } | null;
  hint?: string;
  trend?: (number | null)[];
  meter?: { value: number | null; color?: string } | null;
  onClick?: () => void;
}

export const StatTile: React.FC<StatTileProps> = ({ label, value, delta, hint, trend, meter, onClick }) => {
  const body = (
    <>
      <span className="stat__label">{label}</span>
      <span className="stat__row">
        <span className="stat__value">{value}</span>
        {trend && <Sparkline values={trend} />}
      </span>
      {meter && <Meter value={meter.value} color={meter.color} label={label} />}
      {(delta || hint) && (
        <span className="stat__foot">
          {delta && <span className={`stat__delta stat__delta--${delta.tone}`}>{delta.text}</span>}
          {hint && <span className="stat__hint">{hint}</span>}
        </span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className="stat stat--link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="stat">{body}</div>
  );
};
