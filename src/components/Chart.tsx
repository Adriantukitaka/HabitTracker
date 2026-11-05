import { dayMonth, num } from '../format';
import type { DayValue } from '../types';

/**
 * Gráfico de una variable: línea (tendencia) o barras (comparar días).
 * En barras el eje empieza en 0; en línea se ajusta al rango de los valores.
 */
export function VariableChart({
  series,
  average,
  kind,
  label,
}: {
  series: DayValue[];
  average: number | null;
  kind: 'line' | 'bars';
  label: string;
}) {
  const W = 320;
  const H = 170;
  const left = 34;
  const plotW = W - left;
  const values = series.filter((d) => d.value !== null).map((d) => d.value as number);
  if (!values.length) {
    return <div className="empty">Todavía no hay registros en este rango.</div>;
  }
  const all = average !== null ? [...values, average] : values;
  const lo = kind === 'bars' ? 0 : Math.floor(Math.min(...all) * 0.9);
  let hi = Math.ceil(Math.max(...all) * 1.08);
  if (hi <= lo) hi = lo + 1;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const slot = plotW / series.length;
  const x = (i: number) => left + (i + 0.5) * slot;
  const ticks = [hi, (hi + lo) / 2, lo];
  const last = series.length - 1;
  const points = series.map((d, i) => (d.value === null ? null : ([x(i), y(d.value)] as const))).filter(Boolean) as [number, number][];
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const barW = Math.max(3, slot * (series.length <= 7 ? 0.55 : 0.7));
  const r = series.length <= 7 ? 3.5 : 2.5;

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label={label} style={{ overflow: 'visible', display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="#EFEFEC" />
            <text x={left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="#5E6068" fontFamily="var(--mono)">
              {num(t)}
            </text>
          </g>
        ))}
        {kind === 'bars' &&
          series.map((d, i) =>
            d.value === null ? (
              <rect key={d.date} x={x(i) - barW / 2} y={H - 3} width={barW} height={3} rx={1} fill="#E4E3DE" />
            ) : (
              <rect
                key={d.date}
                x={x(i) - barW / 2}
                y={y(d.value)}
                width={barW}
                height={Math.max(2, H - y(d.value))}
                rx={3}
                fill={i === last ? '#1F883D' : '#9FD9AE'}
              />
            ),
          )}
        {kind === 'line' && (
          <>
            <path d={path} fill="none" stroke="#1F883D" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {series.map((d, i) =>
              d.value === null ? null : (
                <circle
                  key={d.date}
                  cx={x(i)}
                  cy={y(d.value)}
                  r={i === last ? 5 : r}
                  fill={i === last ? '#1F883D' : '#fff'}
                  stroke="#1F883D"
                  strokeWidth={1.5}
                />
              ),
            )}
          </>
        )}
        {average !== null && (
          <>
            <line x1={left} x2={W} y1={y(average)} y2={y(average)} stroke="#6B6D74" strokeWidth={1.5} strokeDasharray="5 4" />
            <text
              x={W}
              y={y(average) - 6}
              textAnchor="end"
              fontSize="10.5"
              fontWeight={700}
              fill="#4A4C53"
              stroke="#fff"
              strokeWidth={3}
              paintOrder="stroke"
            >
              prom. {num(average)}
            </text>
          </>
        )}
        <text x={left} y={H + 16} fontSize="11" fill="#5E6068">
          {dayMonth(series[0].date)}
        </text>
        <text x={W} y={H + 16} fontSize="11" fill="#17181C" fontWeight={700} textAnchor="end">
          Hoy
        </text>
      </svg>
    </figure>
  );
}
