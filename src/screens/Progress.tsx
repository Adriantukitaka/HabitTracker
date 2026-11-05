import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { num, relativeDay, signed, withUnit } from '../format';
import { VariableChart } from '../components/Chart';
import { ChevronLeft } from '../components/Icons';
import { LoadError, Skeleton, useLoad } from '../components/ui';

export default function Progress() {
  const navigate = useNavigate();
  const initial = Number(useParams().variableId);
  const [variableId, setVariableId] = useState(initial);
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<'line' | 'bars'>('line');
  const { data, error, reload } = useLoad(() => api.progress(variableId, days), [variableId, days]);

  if (error && !data) return <main className="screen no-tabs"><LoadError message={error} onRetry={reload} /></main>;
  if (!data) {
    return (
      <main className="screen no-tabs">
        <Skeleton height={70} />
        <Skeleton height={80} />
        <Skeleton height={240} />
      </main>
    );
  }

  const u = data.unit ?? '';
  const todayIso = data.series[data.series.length - 1]?.date ?? '';
  const tone = (v: number | null) => (v === null ? 'var(--muted)' : v > 0 ? 'var(--green-ink)' : v < 0 ? 'var(--red)' : 'var(--muted)');
  const dY = data.today !== null && data.yesterday ? data.today - data.yesterday.value! : null;
  const dA = data.today !== null && data.average !== null ? data.today - data.average : null;
  const yesterdayLabel = data.yesterday ? relativeDay(data.yesterday.date, todayIso) : 'Ayer';

  return (
    <main className="screen no-tabs" style={{ paddingBottom: 40 }}>
      <button type="button" className="back" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => navigate(-1)}>
        <ChevronLeft /> {data.activityTitle}
      </button>
      <div className="stack" style={{ gap: 4, marginTop: -6 }}>
        <h1 className="title" style={{ fontSize: 26 }}>{data.itemName}</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          {data.recordCount} {data.recordCount === 1 ? 'registro' : 'registros'} en {days} días
        </span>
      </div>

      {data.siblings.length > 1 && (
        <div role="tablist" aria-label="Variable" className="seg" style={{ gridTemplateColumns: `repeat(${data.siblings.length}, minmax(0, 1fr))` }}>
          {data.siblings.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === variableId} onClick={() => setVariableId(s.id)}>
              {cap(s.name)}
            </button>
          ))}
        </div>
      )}

      <div className="kpis">
        <div className="kpi hero">
          <span className="label">Hoy</span>
          <span className="value">{num(data.today)}</span>
          <span className="small muted">{data.today === null ? 'sin registro' : u || data.name}</span>
        </div>
        <div className="kpi">
          <span className="label">{yesterdayLabel}</span>
          <span className="value">{num(data.yesterday?.value)}</span>
          <span className="small" style={{ fontWeight: 700, color: tone(dY) }}>
            {dY === null ? (data.yesterday ? u || ' ' : 'sin dato') : `${signed(dY, u)} hoy`}
          </span>
        </div>
        <div className="kpi">
          <span className="label">Promedio {days} d</span>
          <span className="value">{num(data.average)}</span>
          <span className="small" style={{ fontWeight: 700, color: tone(dA) }}>
            {dA === null ? (data.average !== null ? u || ' ' : 'sin dato') : `${signed(dA, u)} hoy`}
          </span>
        </div>
      </div>

      <section className="card" style={{ padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="spread">
          <div className="seg" role="group" aria-label="Tipo de gráfico" style={{ gridTemplateColumns: 'repeat(2, auto)', padding: 3 }}>
            <button type="button" aria-pressed={kind === 'line'} onClick={() => setKind('line')} style={{ minHeight: 34, padding: '0 12px' }}>
              Línea
            </button>
            <button type="button" aria-pressed={kind === 'bars'} onClick={() => setKind('bars')} style={{ minHeight: 34, padding: '0 12px' }}>
              Barras
            </button>
          </div>
          <div className="seg" role="group" aria-label="Rango" style={{ gridTemplateColumns: 'repeat(2, auto)', padding: 3 }}>
            {[7, 30].map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} style={{ minHeight: 34, padding: '0 10px' }}>
                {d} días
              </button>
            ))}
          </div>
        </div>
        <VariableChart
          series={data.series}
          average={data.average}
          kind={kind}
          label={`${cap(data.name)} de ${data.itemName} en los últimos ${days} días; hoy ${num(data.today)}, promedio ${num(data.average)}`}
        />
        <span className="small muted" style={{ lineHeight: 1.45 }}>
          Los días sin registro no cuentan para el promedio.
          {dA !== null && ` Hoy estás ${signed(dA, u)} respecto de tu promedio.`}
        </span>
      </section>

      {data.best && (
        <div className="card pad spread">
          <div className="stack">
            <span className="small muted" style={{ fontWeight: 600 }}>Mejor marca</span>
            <span className="muted" style={{ fontSize: 13 }}>{relativeDay(data.best.date, todayIso)}</span>
          </div>
          <span className="mono" style={{ fontSize: 20, fontWeight: 500 }}>{withUnit(data.best.value, u)}</span>
        </div>
      )}

      <section className="stack" style={{ gap: 6 }}>
        <h2 className="block">Registros anteriores</h2>
        {data.records.length === 0 ? (
          <div className="card empty">Aún no hay registros de esta variable.</div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="records">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col" style={{ textAlign: 'right' }}>{cap(data.name)}</th>
                  <th scope="col" style={{ textAlign: 'right' }}>vs anterior</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.date}>
                    <td style={{ fontWeight: r.date === todayIso ? 700 : 500 }}>{relativeDay(r.date, todayIso)}</td>
                    <td className="num">{withUnit(r.value, u)}</td>
                    <td className="num" style={{ fontSize: 13, color: tone(r.diff) }}>{r.diff === null ? '—' : signed(r.diff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
