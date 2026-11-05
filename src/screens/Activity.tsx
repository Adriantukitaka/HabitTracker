import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { clock, num, withUnit } from '../format';
import type { ItemEntry, OccurrenceDetail, VariableEntry } from '../types';
import { Check, ChevronDown, ChevronLeft, Trend } from '../components/Icons';
import { LoadError, ProgressBar, Skeleton, StatusPill, useLoad, useToast } from '../components/ui';

export default function Activity() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const toast = useToast();
  const { data, setData, error, reload } = useLoad(() => api.occurrence(id), [id]);
  const [values, setValues] = useState<Record<number, number>>({});
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Valores iniciales: lo ya registrado (o 0).
  useEffect(() => {
    if (!data) return;
    const init: Record<number, number> = {};
    data.items.forEach((i) => i.variables.forEach((v) => (init[v.id] = v.value ?? 0)));
    setValues(init);
    setDirty(false);
    setOpen((prev) => prev ?? firstOpenItem(data));
  }, [data]);

  const leafItems = useMemo(() => (data ? data.items.filter((i) => !i.group) : []), [data]);
  const allVars = leafItems.flatMap((i) => i.variables);
  const required = allVars.filter((v) => v.required).length ? allVars.filter((v) => v.required) : allVars;
  const metCount = required.filter((v) => (values[v.id] ?? 0) >= v.target).length;
  const pct = required.length ? Math.round((metCount / required.length) * 100) : 0;

  if (error && !data) return <main className="screen no-tabs"><LoadError message={error} onRetry={reload} /></main>;
  if (!data) {
    return (
      <main className="screen no-tabs">
        <Skeleton height={90} />
        <Skeleton height={60} />
        <Skeleton height={60} />
      </main>
    );
  }

  const card = data.card;
  const editable = data.editable;
  const setValue = (vid: number, value: number) => {
    setValues((prev) => ({ ...prev, [vid]: Math.max(0, Math.round(value * 100) / 100) }));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const payload = allVars.map((v) => ({ variableId: v.id, value: values[v.id] ?? 0 }));
      const detail = await api.saveCheckin(id, payload);
      setData(detail);
      toast({ message: detail.card.status === 'DONE' ? 'Registro guardado · hecho' : 'Registro guardado', high: true });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'No se pudo guardar', high: true });
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(done: boolean) {
    try {
      const detail = done ? await api.saveCheckin(id, [], true) : await api.undo(id).then(() => api.occurrence(id));
      setData(detail);
      toast({ message: done ? `${card.title} marcado como hecho` : 'Registro quitado', high: true });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'No se pudo guardar', high: true });
    }
  }

  async function skip() {
    try {
      await api.skip(id);
      toast({
        message: 'Marcado como descanso',
        high: true,
        undo: async () => setData(await api.undo(id).then(() => api.occurrence(id))),
      });
      setData(await api.occurrence(id));
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'No se pudo guardar', high: true });
    }
  }

  const subtitle = [
    data.routineName && data.routineName !== card.title ? data.routineName : null,
    card.start ? `${card.start} – ${card.end}` : 'Todo el día',
    data.challengeDay && data.challengeLength ? `Reto día ${data.challengeDay} de ${data.challengeLength}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const isToggle = card.mode === 'TOGGLE';
  const saved = !!data.savedAt && !dirty;

  return (
    <>
      <main className="screen no-tabs" style={{ gap: 12 }}>
        <button type="button" className="back" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => navigate(-1)}>
          <ChevronLeft /> Volver
        </button>
        <div className="stack" style={{ gap: 4 }}>
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <h1 className="title" style={{ fontSize: 26 }}>{card.title}</h1>
            <StatusPill status={card.status} />
          </div>
          <span className="muted" style={{ fontSize: 14 }}>{subtitle}</span>
        </div>

        {!editable && (
          <div className="banner">
            {isFuture(card.day)
              ? 'Todavía no se puede registrar: es un día futuro.'
              : data.savedAt ? 'Este registro ya no se puede editar (pasaron más de 24 h).' : 'Ese día ya cerró y no se puede registrar.'}
          </div>
        )}

        {!isToggle && (
          <div className="row">
            <ProgressBar pct={pct} color={pct >= 100 ? undefined : 'var(--amber)'} label="Metas cumplidas" />
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {metCount} de {required.length} {required.length === 1 ? 'meta' : 'metas'}
            </span>
          </div>
        )}

        {isToggle && (
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 15 }}>
              {card.status === 'DONE' && data.savedAt
                ? `Hecho a las ${clock(card.doneAt ?? data.savedAt)}.`
                : card.status === 'SKIPPED'
                  ? 'Hoy es día de descanso para esta actividad.'
                  : 'Esta actividad se marca como hecha, sin variables.'}
            </span>
          </div>
        )}

        {!isToggle &&
          data.items.map((item) =>
            item.group ? (
              <h2 key={item.id} className="section" style={{ marginLeft: (item.depth - 1) * 12 }}>
                {item.name}
              </h2>
            ) : (
              <ItemAccordion
                key={item.id}
                item={item}
                single={leafItems.length === 1}
                open={open === item.id || leafItems.length === 1}
                values={values}
                editable={editable}
                onToggle={() => setOpen(open === item.id ? null : item.id)}
                onChange={setValue}
                onFill={() => item.variables.forEach((v) => setValue(v.id, Math.max(values[v.id] ?? 0, v.target)))}
              />
            ),
          )}

        {editable && card.status !== 'DONE' && card.status !== 'SKIPPED' && (
          <button type="button" className="btn-link" style={{ alignSelf: 'flex-start', color: 'var(--ink-2)' }} onClick={skip}>
            Marcar hoy como descanso
          </button>
        )}
      </main>

      {editable && (
        <footer className="footer">
          <div className="footer-inner">
            {isToggle ? (
              card.status === 'DONE' ? (
                <button type="button" className="btn btn-block" style={{ minHeight: 52 }} onClick={() => toggleDone(false)}>
                  Desmarcar
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-block" onClick={() => toggleDone(true)}>
                  Marcar como hecho
                </button>
              )
            ) : saved ? (
              <div role="status" className="row" style={{ justifyContent: 'center', minHeight: 52, borderRadius: 14, background: 'var(--green-bg)', color: 'var(--green-ink)', fontWeight: 700, gap: 8 }}>
                <Check /> Guardado a las {clock(data.savedAt!)}
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={save}>
                {data.savedAt ? 'Guardar cambios' : 'Guardar registro'}
              </button>
            )}
            <span className="small muted" style={{ textAlign: 'center' }}>
              {saved && data.editableUntil
                ? `Puedes corregirlo hasta ${dayWord(data.editableUntil)} a las ${clock(data.editableUntil)}`
                : !isToggle && pct < 100
                  ? `Se guardará como parcial (${pct} %). Puedes completarlo más tarde.`
                  : 'Se guarda con la hora real.'}
            </span>
          </div>
        </footer>
      )}
    </>
  );
}

function ItemAccordion({
  item,
  single,
  open,
  values,
  editable,
  onToggle,
  onChange,
  onFill,
}: {
  item: ItemEntry;
  single: boolean;
  open: boolean;
  values: Record<number, number>;
  editable: boolean;
  onToggle: () => void;
  onChange: (vid: number, value: number) => void;
  onFill: () => void;
}) {
  const met = item.variables.filter((v) => (values[v.id] ?? 0) >= v.target).length;
  const all = item.variables.length > 0 && met === item.variables.length;
  const any = item.variables.some((v) => (values[v.id] ?? 0) > 0);
  const summary = item.variables.some((v) => (values[v.id] ?? 0) > 0)
    ? item.variables.map((v) => withUnit(values[v.id] ?? 0, v.unit ?? (item.variables.length > 1 ? null : v.name))).join(' · ')
    : 'Sin registrar';
  return (
    <div className={`acc${open && !single ? ' open' : ''}`} style={{ marginLeft: (item.depth - 1) * 12 }}>
      {!single && (
        <button type="button" className="acc-head" aria-expanded={open} onClick={onToggle}>
          <span className={`dot${all ? ' done' : any ? ' partial' : ''}`}>{all && <Check size={14} color="#fff" />}</span>
          <span className="stack grow">
            <span style={{ fontSize: 15, fontWeight: 600 }}>{item.name}</span>
            <span className={any ? 'mono muted' : 'muted'} style={{ fontSize: 13 }}>{summary}</span>
          </span>
          <span style={{ transform: open ? 'rotate(180deg)' : 'none', display: 'flex' }}>
            <ChevronDown color="#5E6068" />
          </span>
        </button>
      )}
      {open && (
        <div className="acc-body" style={single ? { borderTop: 0, paddingTop: 12 } : undefined}>
          {item.variables.map((v) => (
            <VariableRow key={v.id} v={v} value={values[v.id] ?? 0} editable={editable} onChange={(x) => onChange(v.id, x)} />
          ))}
          <div className="spread" style={{ minHeight: 40 }}>
            {editable && !all ? (
              <button type="button" className="btn-link" onClick={onFill}>
                Completar con la meta
              </button>
            ) : (
              <span />
            )}
            {item.variables[0] && (
              <Link to={`/progreso/${item.variables[0].id}`} className="row" style={{ gap: 4, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
                <Trend /> Ver progreso
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VariableRow({
  v,
  value,
  editable,
  onChange,
}: {
  v: VariableEntry;
  value: number;
  editable: boolean;
  onChange: (value: number) => void;
}) {
  const met = value >= v.target;
  const unit = v.unit ? ` ${v.unit}` : '';
  return (
    <div className="row" style={{ paddingTop: 8, gap: 10 }}>
      <div className="stack grow">
        <span style={{ fontSize: 14, fontWeight: 600 }}>{capitalize(v.name)}</span>
        <span style={{ fontSize: 12, color: met ? 'var(--green-ink)' : 'var(--muted)' }}>
          {met ? 'Meta cumplida' : `Meta ${num(v.target)}${unit}`}
          {v.yesterday !== null && ` · ayer ${num(v.yesterday)}${unit}`}
        </span>
      </div>
      <div className="stepper">
        <button type="button" aria-label={`Restar ${v.name}`} disabled={!editable} onClick={() => onChange(value - v.step)}>
          −
        </button>
        <input
          type="number"
          inputMode="decimal"
          aria-label={v.name}
          value={Number.isFinite(value) ? value : 0}
          disabled={!editable}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button type="button" aria-label={`Sumar ${v.name}`} disabled={!editable} onClick={() => onChange(value + v.step)}>
          +
        </button>
      </div>
    </div>
  );
}

function firstOpenItem(d: OccurrenceDetail): number | null {
  const leaves = d.items.filter((i) => !i.group);
  const firstIncomplete = leaves.find((i) => i.variables.some((v) => !v.met));
  return (firstIncomplete ?? leaves[0])?.id ?? null;
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function dayWord(iso: string) {
  const target = new Date(iso);
  const today = new Date();
  const diff = Math.round(
    (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      864e5,
  );
  return diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : target.toLocaleDateString('es', { weekday: 'long' });
}

function isFuture(day: string) {
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  return day > today;
}
