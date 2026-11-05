import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { hhmm, minutes, WEEKDAYS } from '../format';
import type { ActivityInput, Kind, ScheduleCheck } from '../types';
import { ChevronDown, Trash } from '../components/Icons';
import { useToast } from '../components/ui';
import { notificationPermission, requestNotificationPermission } from '../native';

type Measure = 'none' | 'vars' | 'items';
interface VarDraft {
  name: string;
  target: string;
  unit: string;
}
interface ItemDraft {
  name: string;
  vars: VarDraft[];
}

const STEP_NAMES = ['Qué', 'Cuándo', 'Cómo medir'];
const newVar = (): VarDraft => ({ name: '', target: '', unit: '' });

export default function NewActivity() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<Kind>('HABIT');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [days, setDays] = useState([true, true, true, true, true, false, false]);
  const [timed, setTimed] = useState(true);
  const [start, setStart] = useState('18:00');
  const [duration, setDuration] = useState(30);
  const [taskDate, setTaskDate] = useState(() => new Date(Date.now() + 864e5).toLocaleDateString('sv'));
  const [challenge, setChallenge] = useState(30);
  const [adv, setAdv] = useState(false);
  const [flexible, setFlexible] = useState(true);
  const [priority, setPriority] = useState(1);
  const [measure, setMeasure] = useState<Measure>('vars');
  const [vars, setVars] = useState<VarDraft[]>([newVar()]);
  const [items, setItems] = useState<ItemDraft[]>([{ name: '', vars: [newVar()] }]);
  const [check, setCheck] = useState<ScheduleCheck | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const mask = days.reduce((m, on, i) => (on ? m | (1 << i) : m), 0);

  // Revisión de choques en vivo (paso 2).
  useEffect(() => {
    if (step !== 2 || !timed || !start || (kind === 'HABIT' && mask === 0)) {
      setCheck(null);
      return;
    }
    const id = window.setTimeout(() => {
      api
        .checkSchedule({ kind, daysMask: mask, taskDate: kind === 'TASK' ? taskDate : null, start, durationMin: duration })
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 350);
    return () => window.clearTimeout(id);
  }, [step, timed, start, duration, mask, kind, taskDate]);

  function validate(s: number): boolean {
    const e: Record<string, string> = {};
    if (s === 1 && !name.trim()) e.name = 'Escribe un nombre para continuar.';
    if (s === 2) {
      if (kind === 'HABIT' && mask === 0) e.days = 'Elige al menos un día.';
      if (timed && start) {
        const m = minutes(start);
        if (m < 8 * 60 || m + duration > 24 * 60) e.start = 'Elige una hora entre 08:00 y la medianoche.';
      }
      if (kind === 'TASK' && !taskDate) e.date = 'Elige una fecha.';
    }
    if (s === 3) {
      const checkVars = (list: VarDraft[], prefix: string) =>
        list.forEach((v, i) => {
          if (!v.name.trim()) e[`${prefix}${i}.name`] = 'Ponle un nombre';
          if (!(Number(v.target.replace(',', '.')) > 0)) e[`${prefix}${i}.target`] = 'Meta mayor que 0';
        });
      if (measure === 'vars') checkVars(vars, 'v');
      if (measure === 'items') {
        items.forEach((it, i) => {
          if (!it.name.trim()) e[`i${i}.name`] = 'Ponle un nombre';
          checkVars(it.vars, `i${i}.v`);
        });
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const toVar = (v: VarDraft) => ({ name: v.name.trim(), target: Number(v.target.replace(',', '.')), unit: v.unit.trim() || null });

  async function create() {
    if (!validate(3)) return;
    setSaving(true);
    const input: ActivityInput = {
      kind,
      title: name.trim(),
      goal: goal.trim() || null,
      daysMask: kind === 'HABIT' ? mask : undefined,
      taskDate: kind === 'TASK' ? taskDate : null,
      start: timed ? start : null,
      durationMin: duration,
      flexible,
      priority,
      challengeDays: kind === 'HABIT' && challenge > 0 ? challenge : null,
      variables: measure === 'vars' ? vars.map(toVar) : undefined,
      items: measure === 'items' ? items.map((it) => ({ name: it.name.trim(), variables: it.vars.map(toVar) })) : undefined,
    };
    try {
      await api.createActivity(input);
      toast({ message: `${input.title} creada` });
      navigate('/');
      // El primer recordatorio necesita permiso: se pide justo cuando tiene sentido.
      if (input.start && (await notificationPermission()) === 'prompt') void requestNotificationPermission();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'No se pudo crear', high: true });
      setSaving(false);
    }
  }

  const summary = [
    kind === 'HABIT' ? 'Hábito' : 'Tarea',
    kind === 'HABIT' ? (mask === 127 ? 'todos los días' : WEEKDAYS.filter((_, i) => days[i]).map((d) => d.letter).join(', ')) : taskDate,
    timed ? `${start} – ${hhmm(minutes(start) + duration)}` : 'todo el día',
    kind === 'HABIT' && challenge > 0 ? `reto de ${challenge} días` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <main className="screen no-tabs" style={{ gap: 18 }}>
        <header className="stack" style={{ gap: 14 }}>
          <div className="spread">
            <h1 className="title" style={{ fontSize: 22 }}>Nueva actividad</h1>
            <Link to="/" className="btn" style={{ border: 0, color: 'var(--ink-2)' }}>Cancelar</Link>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="steps" aria-hidden="true">
              {[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'on' : ''} />)}
            </div>
            <span className="small muted" style={{ fontSize: 13 }}>
              Paso {step} de 3 · <b style={{ color: 'var(--ink)' }}>{STEP_NAMES[step - 1]}</b>
            </span>
          </div>
        </header>

        {step === 1 && (
          <>
            <div className="stack" style={{ gap: 8 }}>
              <span className="label">¿Qué quieres crear?</span>
              <div role="radiogroup" aria-label="Tipo" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([['HABIT', 'Hábito', 'Se repite los días que elijas'], ['TASK', 'Tarea', 'Se hace una sola vez']] as const).map(([k, t, h]) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} className="choice" onClick={() => setKind(k)}
                    style={{ minHeight: 76, padding: 12, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 15 }}>{t}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>{h}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="name">Nombre</label>
              <input id="name" className={`input${errors.name ? ' invalid' : ''}`} value={name} placeholder="Ej.: Leer, Inglés, Ejercicio"
                aria-invalid={!!errors.name} aria-describedby="name-err" maxLength={120}
                onChange={(e) => { setName(e.target.value); setErrors({}); }} />
              {errors.name && <span id="name-err" className="error">{errors.name}</span>}
            </div>
            <div className="field">
              <label htmlFor="goal">Objetivo <span className="muted" style={{ fontWeight: 500 }}>(opcional)</span></label>
              <input id="goal" className="input" value={goal} maxLength={240} placeholder="Ej.: Llegar a B2 antes de fin de año" onChange={(e) => setGoal(e.target.value)} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {kind === 'HABIT' ? (
              <div className="stack" style={{ gap: 8 }}>
                <span className="label">¿Qué días?</span>
                <div role="group" aria-label="Días de la semana" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
                  {WEEKDAYS.map((d, i) => (
                    <button key={d.name} type="button" className="choice" aria-pressed={days[i]} aria-label={d.name}
                      onClick={() => setDays(days.map((x, j) => (j === i ? !x : x)))}>{d.letter}</button>
                  ))}
                </div>
                <div className="row" style={{ gap: 16 }}>
                  <button type="button" className="btn-link" onClick={() => setDays(Array(7).fill(true))}>Todos los días</button>
                  <button type="button" className="btn-link" onClick={() => setDays([true, true, true, true, true, false, false])}>Lunes a viernes</button>
                </div>
                {errors.days && <span className="error">{errors.days}</span>}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="date">Fecha</label>
                <input id="date" className="input" type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} />
                {errors.date && <span className="error">{errors.date}</span>}
              </div>
            )}

            <div className="spread">
              <div className="stack">
                <span style={{ fontSize: 14, fontWeight: 600 }}>Con hora</span>
                <span className="small muted">Si no, cuenta para todo el día y no choca con nada</span>
              </div>
              <button type="button" role="switch" aria-checked={timed} aria-label="Con hora" className="switch" onClick={() => setTimed(!timed)}><span /></button>
            </div>

            {timed && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label htmlFor="start">Hora</label>
                  <input id="start" className={`input mono${errors.start ? ' invalid' : ''}`} type="time" min="08:00" max="23:45" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="dur">Duración</label>
                  <select id="dur" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} ${m === 60 ? 'hora' : 'horas'}`}</option>)}
                  </select>
                </div>
              </div>
            )}
            {errors.start && <span className="error">{errors.start}</span>}

            {timed && check && check.conflicts.length > 0 && (
              <div role="alert" className="alert">
                <span>
                  <b>Se cruza con «{check.conflicts[0].title}»</b> ({check.conflicts[0].start} – {check.conflicts[0].end})
                  {check.conflicts.length > 1 && ` y ${check.conflicts.length - 1} ${check.conflicts.length === 2 ? 'día más' : 'días más'}`}.
                </span>
                {check.suggestion && (
                  <button type="button" className="btn" onClick={() => setStart(check.suggestion!.start)}>
                    Usar el hueco libre: {check.suggestion.start}
                  </button>
                )}
              </div>
            )}
            {timed && check && check.conflicts.length === 0 && (
              <div role="status" className="ok-line">✓ Sin choques en ese horario</div>
            )}

            {kind === 'HABIT' && (
              <div className="field">
                <label htmlFor="challenge">Duración del reto</label>
                <select id="challenge" className="select" value={challenge} onChange={(e) => setChallenge(Number(e.target.value))}>
                  {[21, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} días</option>)}
                  <option value={0}>Sin fecha de fin</option>
                </select>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button type="button" aria-expanded={adv} onClick={() => setAdv(!adv)} className="spread"
                style={{ minHeight: 44, border: 0, background: 'none', padding: 0, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Opciones avanzadas
                <span style={{ transform: adv ? 'rotate(180deg)' : 'none', display: 'flex' }}><ChevronDown color="#5E6068" /></span>
              </button>
              {adv && (
                <>
                  <div className="spread">
                    <div className="stack">
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Puede moverse si hay choque</span>
                      <span className="small muted">Si está apagado, se mantiene fija</span>
                    </div>
                    <button type="button" role="switch" aria-checked={flexible} aria-label="Puede moverse si hay choque" className="switch" onClick={() => setFlexible(!flexible)}><span /></button>
                  </div>
                  <div className="field">
                    <label htmlFor="prio">Prioridad</label>
                    <select id="prio" className="select" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                      <option value={0}>Baja</option>
                      <option value={1}>Media</option>
                      <option value={2}>Alta</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="stack" style={{ gap: 8 }}>
              <span className="label">¿Cómo vas a medir el avance?</span>
              <div role="tablist" aria-label="Forma de medir" className="seg" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {([['none', 'Solo hecho'], ['vars', 'Variables'], ['items', 'Subactividades']] as const).map(([k, t]) => (
                  <button key={k} type="button" role="tab" aria-selected={measure === k} onClick={() => { setMeasure(k); setErrors({}); }}>{t}</button>
                ))}
              </div>
              <span className="small muted" style={{ lineHeight: 1.5 }}>
                {measure === 'none' && 'Se marca como hecha con un toque.'}
                {measure === 'vars' && 'Cuenta lo que quieras con el nombre que quieras: páginas, vasos, minutos…'}
                {measure === 'items' && 'Por ejemplo, ejercicios de una rutina, cada uno con sus series, repeticiones o peso.'}
              </span>
            </div>

            {measure === 'vars' && (
              <VarList vars={vars} prefix="v" errors={errors} onChange={setVars} />
            )}

            {measure === 'items' && (
              <>
                {items.map((it, i) => (
                  <div key={i} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                      <div className="field grow">
                        <label htmlFor={`item-${i}`} style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Subactividad {i + 1}</label>
                        <input id={`item-${i}`} className={`input${errors[`i${i}.name`] ? ' invalid' : ''}`} placeholder="Ej.: Sentadilla" value={it.name}
                          onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      </div>
                      {items.length > 1 && (
                        <button type="button" className="icon-btn" style={{ border: 0 }} aria-label={`Quitar subactividad ${it.name || i + 1}`}
                          onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash color="#5E6068" /></button>
                      )}
                    </div>
                    {errors[`i${i}.name`] && <span className="error">{errors[`i${i}.name`]}</span>}
                    <VarList vars={it.vars} prefix={`i${i}.v`} errors={errors} compact
                      onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, vars: v } : x)))} />
                  </div>
                ))}
                <button type="button" className="btn" onClick={() => setItems([...items, { name: '', vars: [newVar()] }])}>+ Agregar subactividad</button>
              </>
            )}

            <div style={{ background: '#EFEFEA', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>RESUMEN</span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{name || 'Sin nombre'}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{summary}</span>
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-row">
            {step > 1 && (
              <button type="button" className="btn" style={{ flex: 1, minHeight: 52 }} onClick={() => setStep(step - 1)}>Atrás</button>
            )}
            {step < 3 ? (
              <button type="button" className="btn btn-primary" style={{ flex: 2 }} onClick={() => validate(step) && setStep(step + 1)}>Siguiente</button>
            ) : (
              <button type="button" className="btn btn-primary" style={{ flex: 2 }} disabled={saving} onClick={create}>Crear actividad</button>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

function VarList({
  vars,
  prefix,
  errors,
  compact,
  onChange,
}: {
  vars: VarDraft[];
  prefix: string;
  errors: Record<string, string>;
  compact?: boolean;
  onChange: (v: VarDraft[]) => void;
}) {
  const set = (i: number, patch: Partial<VarDraft>) => onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {vars.map((v, i) => {
        const nameErr = errors[`${prefix}${i}.name`];
        const targetErr = errors[`${prefix}${i}.target`];
        return (
          <div key={i} className={compact ? '' : 'card'} style={compact ? { display: 'flex', flexDirection: 'column', gap: 4 } : { padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr 2fr auto', gap: 8, alignItems: 'end' }}>
              <div className="field" style={{ gap: 4 }}>
                <span className="small muted">Variable</span>
                <input className={`input${nameErr ? ' invalid' : ''}`} style={{ height: 44, padding: '0 10px' }} placeholder="páginas" aria-label="Nombre de la variable" value={v.name} onChange={(e) => set(i, { name: e.target.value })} />
              </div>
              <div className="field" style={{ gap: 4 }}>
                <span className="small muted">Meta</span>
                <input className={`input mono${targetErr ? ' invalid' : ''}`} style={{ height: 44, padding: '0 10px' }} inputMode="decimal" placeholder="8" aria-label="Meta diaria" value={v.target} onChange={(e) => set(i, { target: e.target.value })} />
              </div>
              <div className="field" style={{ gap: 4 }}>
                <span className="small muted">Unidad</span>
                <input className="input" style={{ height: 44, padding: '0 10px' }} placeholder="kg" aria-label="Unidad (opcional)" value={v.unit} onChange={(e) => set(i, { unit: e.target.value })} />
              </div>
              <button type="button" className="icon-btn" style={{ border: 0, width: 40 }} aria-label={`Quitar variable ${v.name || i + 1}`} disabled={vars.length === 1}
                onClick={() => onChange(vars.filter((_, j) => j !== i))}><Trash color={vars.length === 1 ? '#C9CBD1' : '#5E6068'} /></button>
            </div>
            {(nameErr || targetErr) && <span className="error">{[nameErr, targetErr].filter(Boolean).join(' · ')}</span>}
          </div>
        );
      })}
      <button type="button" className={compact ? 'btn-link' : 'btn'} style={compact ? { alignSelf: 'flex-start' } : undefined} onClick={() => onChange([...vars, newVar()])}>
        + Agregar variable
      </button>
    </div>
  );
}
