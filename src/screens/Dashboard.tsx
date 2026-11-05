import { Link } from 'react-router-dom';
import { api } from '../api';
import { parseDay } from '../format';
import type { HeatCell } from '../types';
import { LoadError, Skeleton, useLoad } from '../components/ui';

const HEAT = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function Dashboard() {
  const { data, error, reload } = useLoad(api.dashboard, []);

  if (error && !data) return <main className="screen"><LoadError message={error} onRetry={reload} /></main>;
  if (!data) {
    return (
      <main className="screen">
        <Skeleton height={60} />
        <Skeleton height={80} />
        <Skeleton height={170} />
      </main>
    );
  }

  const weeks: HeatCell[][] = [];
  for (let i = 0; i < data.heatmap.length; i += 7) weeks.push(data.heatmap.slice(i, i + 7));
  const todayCell = [...data.heatmap].reverse().find((c) => !c.future);
  const monthMarks = weeks
    .map((w, i) => ({ i, m: parseDay(w[0].date).getUTCMonth() }))
    .filter((x, idx, arr) => idx === 0 || arr[idx - 1].m !== x.m);

  return (
    <main className="screen">
      <div className="stack">
        <span className="eyebrow">Últimas {weeks.length} semanas</span>
        <h1 className="title">Tablero</h1>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="label">Racha actual</span>
          <span className="value">{data.streak}<span className="small muted"> {data.streak === 1 ? 'día' : 'días'}</span></span>
        </div>
        <div className="kpi">
          <span className="label">Racha máxima</span>
          <span className="value">{data.bestStreak}<span className="small muted"> {data.bestStreak === 1 ? 'día' : 'días'}</span></span>
        </div>
        <div className="kpi">
          <span className="label">Esta semana</span>
          <span className="value" style={{ color: 'var(--green-ink)' }}>{data.weekPct}%</span>
        </div>
      </div>

      <section className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="spread" style={{ alignItems: 'baseline' }}>
          <h2 className="block" style={{ margin: 0 }}>Actividad</h2>
          <span className="small muted">{data.totalCheckins} registros</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div className="row" style={{ gap: 6, alignItems: 'flex-start', width: 'max-content' }}>
            <div className="heat-col" aria-hidden="true">
              {['L', '', 'X', '', 'V', '', 'D'].map((d, i) => (
                <span key={i} style={{ height: 12, fontSize: 9, lineHeight: '12px', color: 'var(--muted)' }}>{d}</span>
              ))}
            </div>
            <div className="heat" role="img" aria-label={`Mapa de cumplimiento diario de las últimas ${weeks.length} semanas`}>
              {weeks.map((w) => (
                <div key={w[0].date} className="heat-col">
                  {w.map((c) => (
                    <div
                      key={c.date}
                      className="heat-cell"
                      title={c.future ? undefined : `${c.date}: ${Math.round(c.pct)} %`}
                      style={{
                        background: c.future ? 'transparent' : HEAT[c.level],
                        outline: c === todayCell ? '1.5px solid var(--ink)' : c.future ? '1px dashed var(--line)' : 'none',
                        outlineOffset: 1,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative', height: 16, marginLeft: 20, marginTop: 4 }}>
            {monthMarks.map((m) => (
              <span key={m.i} className="small muted" style={{ position: 'absolute', left: m.i * 15, fontSize: 11 }}>
                {MONTHS[m.m]}
              </span>
            ))}
          </div>
        </div>
        <div className="legend" style={{ justifyContent: 'flex-end' }}>
          <span style={{ marginRight: 2 }}>Menos</span>
          {HEAT.map((c) => <span key={c} className="sw" style={{ background: c }} />)}
          <span style={{ marginLeft: 2 }}>Más</span>
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="block">Retos activos</h2>
        {data.challenges.length === 0 && (
          <div className="card empty">
            Cuando crees un hábito, aquí verás su racha y su avance.
          </div>
        )}
        {data.challenges.map((c) => (
          <div key={c.activityId} className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="spread" style={{ alignItems: 'baseline' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{c.title}</span>
              {c.day !== null && (
                <span className="mono small muted">día {c.day}{c.of ? `/${c.of}` : ''}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 3 }} role="img" aria-label={`Últimos 14 días de ${c.title}`}>
              {c.last14.map((s, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 10,
                    borderRadius: 2,
                    background: s === 'DONE' ? 'var(--green-2)' : s === 'PARTIAL' ? '#F2B35B' : s === 'SKIPPED' ? '#D6D5CF' : 'var(--heat-0)',
                  }}
                />
              ))}
            </div>
            <div className="spread small muted">
              <span>{c.goal ?? ' '}</span>
              <span>
                Racha <b style={{ color: 'var(--ink)' }}>{c.streak}</b> · <b style={{ color: 'var(--green-ink)' }}>{c.rate}%</b>
              </span>
            </div>
          </div>
        ))}
      </section>

      <Link to="/nueva" className="btn" style={{ alignSelf: 'center' }}>
        Nueva actividad
      </Link>
    </main>
  );
}
