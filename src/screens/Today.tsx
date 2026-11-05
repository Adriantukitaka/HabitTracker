import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { longDate, minutes } from '../format';
import type { OccurrenceCard, Resolution, TodayView } from '../types';
import { Check, ChevronRight, Plus } from '../components/Icons';
import { LoadError, ProgressBar, Sheet, Skeleton, useLoad, useToast } from '../components/ui';

export default function Today() {
  const { data, setData, error, loading, reload } = useLoad(api.today, []);
  const toast = useToast();
  const [sheetFor, setSheetFor] = useState<number | null>(null);

  // Refresca cada minuto (cambia la actividad "en curso") y al volver a la app.
  useEffect(() => {
    const id = window.setInterval(() => void reload(), 60_000);
    const onResume = () => void reload();
    window.addEventListener('constancia:resume', onResume);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('constancia:resume', onResume);
    };
  }, [reload]);

  if (error && !data) return <main className="screen"><LoadError message={error} onRetry={reload} /></main>;
  if (!data) {
    return (
      <main className="screen" aria-busy={loading}>
        <Skeleton height={60} />
        <Skeleton height={150} />
        <Skeleton height={70} />
        <Skeleton height={70} />
      </main>
    );
  }

  const replace = (card: OccurrenceCard) =>
    setData((prev) => (prev ? withCard(prev, card) : prev));

  /** Aplica una acción, actualiza la tarjeta y ofrece deshacer. */
  async function act(
    card: OccurrenceCard,
    run: () => Promise<OccurrenceCard>,
    message: string,
    undo: () => Promise<OccurrenceCard>,
  ) {
    try {
      replace(await run());
      toast({
        message,
        undo: async () => {
          try {
            replace(await undo());
          } catch {
            void reload();
          }
        },
      });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'No se pudo guardar' });
      replace(card);
    }
  }

  const toggle = (c: OccurrenceCard) =>
    act(c, () => api.saveCheckin(c.id, [], true).then((d) => d.card), `${c.title} marcado como hecho`, () => api.undo(c.id));

  const plusOne = (c: OccurrenceCard) => {
    const counter = c.counter!;
    const next = counter.value + counter.step;
    act(
      c,
      () => api.increment(c.id, counter.variableId, counter.step),
      `${c.title}: ${String(next).replace('.', ',')} de ${counter.target} ${counter.name}`,
      () => api.increment(c.id, counter.variableId, -counter.step),
    );
  };

  const hero = pickHero(data);
  const others = data.items.filter((c) => c.id !== hero?.id);
  const pending = others.filter((c) => c.status !== 'DONE' && c.status !== 'SKIPPED');
  const done = others.filter((c) => c.status === 'DONE' || c.status === 'SKIPPED');
  const pct = data.total ? (data.doneCount / data.total) * 100 : 0;

  return (
    <main className="screen">
      <header className="spread">
        <div className="stack">
          <span className="eyebrow">{longDate(data.date)}</span>
          <h1 className="title">Hoy</h1>
        </div>
        <Link to="/nueva" className="btn btn-pill">
          <Plus /> Nueva
        </Link>
      </header>

      {data.total > 0 && (
        <div className="row">
          <ProgressBar pct={pct} label="Avance del día" />
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {data.doneCount} de {data.total} hechas
          </span>
        </div>
      )}

      {hero && <HeroCard card={hero} isNow={hero.id === data.currentId} onToggle={toggle} onPlus={plusOne} />}

      {data.items.length === 0 && (
        <div className="card empty">
          <p style={{ margin: '0 0 14px' }}>No tienes nada agendado para hoy.</p>
          <Link to="/nueva" className="btn btn-primary">Crear tu primera actividad</Link>
        </div>
      )}

      {pending.length > 0 && <h2 className="section">{hero ? 'Más tarde' : 'Pendientes'}</h2>}
      {pending.map((c) => (
        <Item
          key={c.id}
          card={c}
          canResolve={shouldResolve(c, data.items)}
          onToggle={toggle}
          onPlus={plusOne}
          onResolve={() => setSheetFor(c.id)}
        />
      ))}

      {done.length > 0 && <h2 className="section">Hechas</h2>}
      {done.map((c) => (
        <Link key={c.id} to={`/actividad/${c.id}`} className="item done" style={{ textDecoration: 'none' }}>
          <span className="time">{c.start ?? 'Día'}</span>
          <div className="stack grow">
            <span className="name">{c.title}</span>
            <span className="small muted">{c.status === 'SKIPPED' ? 'Descanso' : c.subtitle}</span>
          </div>
          {c.status === 'DONE' && (
            <span className="check-done" aria-label="Hecho">
              <Check size={16} color="#fff" />
            </span>
          )}
        </Link>
      ))}

      {sheetFor !== null && (
        <ResolveSheet
          occurrenceId={sheetFor}
          onClose={() => setSheetFor(null)}
          onMoved={(view, res) => {
            setData(view);
            setSheetFor(null);
            toast({
              message: `${res.moveTitle} movido a ${res.proposal!.start}`,
              undo: async () => setData(await api.move(res.moveOccurrenceId, res.from)),
            });
          }}
        />
      )}
    </main>
  );
}

function withCard(view: TodayView, card: OccurrenceCard): TodayView {
  const items = view.items.map((c) => (c.id === card.id ? card : c));
  return {
    ...view,
    items,
    doneCount: items.filter((c) => c.status === 'DONE').length,
    total: items.filter((c) => c.status !== 'SKIPPED').length,
  };
}

/** Rango de permanencia (igual que el motor): tarea fija > hábito fijo > flexible; luego prioridad. */
function rank(c: OccurrenceCard) {
  const tier = !c.fixed ? 0 : c.kind === 'TASK' ? 2 : 1;
  return tier * 10 + c.priority;
}

/** "Resolver" solo aparece en la actividad que conviene mover (la de menor rango del choque). */
function shouldResolve(c: OccurrenceCard, all: OccurrenceCard[]) {
  if (!c.conflicts.length) return false;
  const partners = c.conflicts.map((r) => all.find((x) => x.id === r.occurrenceId)).filter(Boolean) as OccurrenceCard[];
  return partners.every((p) => rank(c) <= rank(p));
}

/** En curso; si no hay, la próxima con hora que siga pendiente. */
function pickHero(view: TodayView): OccurrenceCard | undefined {
  if (view.currentId !== null) return view.items.find((c) => c.id === view.currentId);
  const now = minutes(view.now);
  return view.items.find(
    (c) => c.start && minutes(c.start) > now && (c.status === 'PENDING' || c.status === 'PARTIAL') && !c.conflicts.length,
  );
}

function HeroCard({
  card,
  isNow,
  onToggle,
  onPlus,
}: {
  card: OccurrenceCard;
  isNow: boolean;
  onToggle: (c: OccurrenceCard) => void;
  onPlus: (c: OccurrenceCard) => void;
}) {
  return (
    <section className="now-card" aria-label={isNow ? 'Actividad en curso' : 'Próxima actividad'}>
      <div className="stack" style={{ gap: 4 }}>
        <span className="now-label">
          {isNow ? 'Ahora' : 'A continuación'} · {card.start} – {card.end}
        </span>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{card.title}</span>
        <span className="muted" style={{ fontSize: 13 }}>{card.subtitle}</span>
      </div>
      {card.mode === 'ROUTINE' && (
        <Link to={`/actividad/${card.id}`} className="btn btn-primary">
          Registrar ahora
        </Link>
      )}
      {card.mode === 'COUNTER' && card.counter && (
        <>
          <ProgressBar thin pct={(card.counter.value / card.counter.target) * 100} label={card.title} />
          <button type="button" className="btn btn-primary" onClick={() => onPlus(card)}>
            +{String(card.counter.step).replace('.', ',')} {card.counter.name}
          </button>
        </>
      )}
      {card.mode === 'TOGGLE' && (
        <button type="button" className="btn btn-primary" onClick={() => onToggle(card)}>
          Marcar como hecho
        </button>
      )}
    </section>
  );
}

function Item({
  card,
  canResolve,
  onToggle,
  onPlus,
  onResolve,
}: {
  card: OccurrenceCard;
  canResolve: boolean;
  onToggle: (c: OccurrenceCard) => void;
  onPlus: (c: OccurrenceCard) => void;
  onResolve: () => void;
}) {
  const conflict = card.conflicts[0];
  const showBar = card.mode !== 'TOGGLE' && card.progress > 0;
  return (
    <div className="item" style={{ flexWrap: 'wrap' }}>
      <span className="time">{card.start ?? 'Día'}</span>
      <Link to={`/actividad/${card.id}`} className="stack grow" style={{ textDecoration: 'none' }}>
        <span className="name">{card.title}</span>
        <span className="small muted">{card.subtitle}</span>
        {conflict && <span className="pill conflict" style={{ marginTop: 2 }}>Choca con {conflict.title}</span>}
      </Link>
      {conflict && canResolve ? (
        <button type="button" className="btn" style={{ fontSize: 13, fontWeight: 700 }} aria-label={`Resolver choque de ${card.title}`} onClick={onResolve}>
          Resolver
        </button>
      ) : card.mode === 'TOGGLE' ? (
        <button type="button" className="icon-btn" aria-label={`Marcar ${card.title} como hecho`} onClick={() => onToggle(card)}>
          <Check color="#A3A5AC" />
        </button>
      ) : card.mode === 'COUNTER' ? (
        <button type="button" className="btn" style={{ fontWeight: 700 }} aria-label={`Sumar a ${card.title}`} onClick={() => onPlus(card)}>
          +{String(card.counter?.step ?? 1).replace('.', ',')}
        </button>
      ) : (
        <Link to={`/actividad/${card.id}`} className="icon-btn" style={{ border: 0 }} aria-label={`Abrir ${card.title}`}>
          <ChevronRight color="#5E6068" />
        </Link>
      )}
      {showBar && (
        <div style={{ flexBasis: '100%', paddingLeft: 56 }}>
          <ProgressBar thin pct={card.progress} color={card.progress >= 100 ? undefined : 'var(--amber)'} label={card.title} />
        </div>
      )}
    </div>
  );
}

function ResolveSheet({
  occurrenceId,
  onClose,
  onMoved,
}: {
  occurrenceId: number;
  onClose: () => void;
  onMoved: (view: TodayView, res: Resolution) => void;
}) {
  const [res, setRes] = useState<Resolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.resolution(occurrenceId).then(setRes).catch((e: Error) => setError(e.message));
  }, [occurrenceId]);

  return (
    <Sheet label="Resolver choque" onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Dos actividades a la misma hora</h2>
      {error && <p className="error">{error}</p>}
      {!res && !error && <Skeleton height={120} />}
      {res && (
        <>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>{res.reason}</p>
          {res.proposal && (
            <div className="compare">
              <div>
                <span className="muted">Ahora</span>
                <span className="mono" style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>
                  {res.from} – {addMinutes(res.from, res.proposal)}
                </span>
              </div>
              <div style={{ background: '#F2FBF4' }}>
                <span style={{ fontWeight: 700, color: 'var(--green-ink)' }}>Propuesta</span>
                <span className="mono" style={{ fontWeight: 500 }}>
                  {res.proposal.start} – {res.proposal.end}
                </span>
              </div>
            </div>
          )}
          {res.proposal && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  onMoved(await api.move(res.moveOccurrenceId, res.proposal!.start), res);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'No se pudo mover');
                  setBusy(false);
                }
              }}
            >
              Mover {res.moveTitle} a {res.proposal.start}
            </button>
          )}
          <Link to={`/actividad/${res.moveOccurrenceId}`} className="btn" style={{ minHeight: 48 }}>
            Ver {res.moveTitle}
          </Link>
        </>
      )}
    </Sheet>
  );
}

function addMinutes(from: string, slot: { start: string; end: string }) {
  const dur = minutes(slot.end) - minutes(slot.start);
  const end = minutes(from) + dur;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}
