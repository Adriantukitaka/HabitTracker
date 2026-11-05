import * as E from '../engine/intervals';
import * as S from '../engine/stats';
import type * as T from '../types';
import { type Activity, type Checkin, type Data, Db, isData, type Item, type Occurrence, type Status, type Variable } from './db';

export const HORIZON_DAYS = 7;
const EDIT_WINDOW_MS = 24 * 3600e3;
const MAX_DEPTH = 3;

export class ServiceError extends Error {}

export interface Clock {
  now(): Date;
}

/** Un aviso que el teléfono debe mostrar a una hora exacta. */
export interface Planned {
  id: number;
  title: string;
  body: string;
  at: Date;
  url: string;
}

const hhmm = (m: number | null) =>
  m === null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new ServiceError(`Hora inválida: ${s}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new ServiceError(`Hora inválida: ${s}`);
  return h * 60 + min;
};
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10).replace('.', ','));
const PRIORITY = ['baja', 'media', 'alta'];

export class Local {
  /** Se llama después de cada cambio (para reagendar los avisos del teléfono). */
  onChange: () => void = () => {};

  constructor(
    private db: Db,
    private clock: Clock = { now: () => new Date() },
  ) {}

  private get d(): Data {
    return this.db.data;
  }

  // ---------------------------------------------------------------- tiempo local

  private now() {
    return this.clock.now();
  }
  today(): string {
    const n = this.now();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }
  private nowMin() {
    const n = this.now();
    return n.getHours() * 60 + n.getMinutes();
  }
  /** Instante local del minuto `min` del día `day` (1440 = medianoche siguiente). */
  private at(day: string, min: number): Date {
    const [y, m, dd] = day.split('-').map(Number);
    return new Date(y, m - 1, dd, 0, min);
  }
  private stamp(d: Date = this.now()) {
    return d.toISOString();
  }

  // ---------------------------------------------------------------- búsquedas

  private act(id: number): Activity {
    const a = this.d.activities.find((x) => x.id === id);
    if (!a) throw new ServiceError('La actividad no existe');
    return a;
  }
  private occ(id: number): Occurrence {
    const o = this.d.occurrences.find((x) => x.id === id);
    if (!o) throw new ServiceError('La actividad del día no existe');
    return o;
  }
  private checkin(o: Occurrence): Checkin | undefined {
    return this.d.checkins[o.id];
  }
  private itemsOf(a: Activity): Item[] {
    return a.routineId === null
      ? []
      : this.d.items.filter((i) => i.routineId === a.routineId).sort((x, y) => x.position - y.position);
  }
  private varsOf(a: Activity): Variable[] {
    if (a.routineId === null) return [];
    const ids = new Set(this.itemsOf(a).map((i) => i.id));
    return this.d.variables.filter((v) => ids.has(v.itemId)).sort((x, y) => x.position - y.position);
  }
  private groupIds(a: Activity): Set<number> {
    return new Set(this.itemsOf(a).filter((i) => i.parentId !== null).map((i) => i.parentId as number));
  }
  private mode(a: Activity): T.Mode {
    const vs = this.varsOf(a);
    if (!vs.length) return 'TOGGLE';
    const leaves = this.itemsOf(a).length - this.groupIds(a).size;
    return vs.length === 1 && leaves === 1 ? 'COUNTER' : 'ROUTINE';
  }
  private dayOccs(day: string): Occurrence[] {
    return this.d.occurrences
      .filter((o) => o.day === day && this.act(o.activityId).status !== 'PAUSED')
      .sort((x, y) => (x.startMin ?? -1) - (y.startMin ?? -1) || x.id - y.id);
  }

  /** Valor del día de cada variable, según su agregación. */
  private dayValues(o: Occurrence): Record<number, number> {
    const c = this.checkin(o);
    const out: Record<number, number> = {};
    if (!c) return out;
    for (const v of this.varsOf(this.act(o.activityId))) {
      const val = S.dailyValue(c.entries.filter((e) => e.variableId === v.id).map((e) => e.value), v.aggregation);
      if (val !== null) out[v.id] = val;
    }
    return out;
  }

  // ---------------------------------------------------------------- generación y cierre

  private scheduledOn(a: Activity, day: string) {
    if (a.kind === 'TASK') return day === a.taskDate;
    if (day < a.challengeStart) return false;
    if (a.challengeEnd && day > a.challengeEnd) return false;
    return S.includesDay(a.daysMask, day);
  }

  private generate(a: Activity, from: string, to: string): number {
    let created = 0;
    for (let day = from; day <= to; day = S.addDays(day, 1)) {
      if (!this.scheduledOn(a, day) || this.d.occurrences.some((o) => o.activityId === a.id && o.day === day)) continue;
      const start = a.start;
      this.d.occurrences.push({
        id: this.db.nextId(),
        activityId: a.id,
        day,
        startMin: start,
        endMin: start === null ? null : Math.min(start + a.durationMin, this.d.settings.dayEnd),
        status: 'PENDING',
        progress: 0,
        movedFrom: null,
      });
      created++;
    }
    return created;
  }

  /**
   * Mantenimiento al abrir y en cada consulta: cierra días pasados, termina retos vencidos, genera
   * los próximos 7 días y anota en la bandeja los avisos que el teléfono mostró desde la última vez.
   */
  async tick(): Promise<void> {
    const t = this.today();
    const now = this.now();
    const before = JSON.stringify([this.d.lastTick?.slice(0, 13), this.d.occurrences.length, this.d.notices.length]);
    let changed = false;

    for (const o of this.d.occurrences) {
      if (o.day < t && (o.status === 'PENDING' || o.status === 'PARTIAL')) {
        const prev = o.status;
        this.recompute(o);
        if (o.status !== prev) changed = true;
      }
    }
    for (const a of this.d.activities) {
      if (a.status === 'ACTIVE' && a.challengeEnd && a.challengeEnd < t) {
        a.status = 'ENDED';
        changed = true;
      }
    }
    for (const a of this.d.activities) {
      if (a.status === 'ACTIVE' && this.generate(a, t, S.addDays(t, HORIZON_DAYS - 1)) > 0) changed = true;
    }

    if (this.d.lastTick) {
      const since = new Date(this.d.lastTick);
      const fromDay = this.d.lastTick.slice(0, 10) < t ? S.addDays(t, -7) : t;
      const s = this.d.settings;
      for (const o of this.d.occurrences) {
        if (o.day < fromDay || o.day > t || o.startMin === null) continue;
        const a = this.act(o.activityId);
        if (a.status === 'PAUSED' || o.status === 'SKIPPED') continue;
        const c = this.checkin(o);
        const reminder = this.at(o.day, o.startMin);
        const nudge = this.at(o.day, o.startMin + s.nudgeMinutes);
        const range = `${hhmm(o.startMin)} – ${hhmm(o.endMin)}`;
        const doneBefore = (when: Date) => o.status === 'DONE' && !!c && new Date(c.editedAt ?? c.createdAt) <= when;
        if (reminder > since && reminder <= now && !doneBefore(reminder)) {
          this.notice(`R${o.id}`, o.id, 'REMINDER', `Es hora de ${a.title}`, range, reminder);
        }
        if (nudge > since && nudge <= now && (!c || new Date(c.createdAt) > nudge)) {
          this.notice(`N${o.id}`, o.id, 'NUDGE', `${a.title} empezó hace ${s.nudgeMinutes} min`, 'Todavía no hay registro. Ábrelo para marcar tu avance.', nudge);
        }
      }
      for (let day = fromDay; day <= t; day = S.addDays(day, 1)) {
        const when = this.at(day, s.summaryMin);
        if (when > since && when <= now) {
          const sum = this.summaryText(day);
          if (sum) this.notice(`S${day}`, null, 'SUMMARY', sum.title, sum.body, when);
        }
      }
    }
    this.d.lastTick = this.stamp(now);
    const after = JSON.stringify([this.d.lastTick.slice(0, 13), this.d.occurrences.length, this.d.notices.length]);
    if (changed || before !== after) await this.db.save();
  }

  private notice(key: string, occurrenceId: number | null, type: T.NotificationView['type'], title: string, body: string, at = this.now()) {
    if (this.d.notices.some((n) => n.key === key)) return;
    // "Hecho" lo hizo la propia persona: queda en el historial pero no suma al contador de no leídos.
    this.d.notices.push({ id: this.db.nextId(), key, occurrenceId, type, title, body, createdAt: this.stamp(at), read: type === 'DONE' });
    this.d.notices.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
    if (this.d.notices.length > 300) this.d.notices.length = 300;
  }

  private summaryText(day: string): { title: string; body: string } | null {
    const cards = this.dayOccs(day);
    const total = cards.filter((o) => o.status !== 'SKIPPED').length;
    if (!total) return null;
    const done = cards.filter((o) => o.status === 'DONE').length;
    const pending = cards.filter((o) => ['PENDING', 'PARTIAL', 'MISSED'].includes(o.status)).map((o) => this.act(o.activityId).title);
    return {
      title: `Hoy: ${done} de ${total} cumplidas`,
      body: pending.length ? `Quedan: ${pending.join(', ')}. El día cierra a medianoche.` : 'Cumpliste todo. Buen trabajo.',
    };
  }

  private async commit() {
    await this.db.save();
    this.onChange();
  }

  // ---------------------------------------------------------------- estado de una ocurrencia

  private recompute(o: Occurrence) {
    const a = this.act(o.activityId);
    const vs = this.varsOf(a);
    const c = this.checkin(o);
    if (o.status === 'SKIPPED' && !c) return;
    let status: Status;
    let progress: number;
    if (!vs.length) {
      status = c?.done ? 'DONE' : 'PENDING';
      progress = c?.done ? 100 : 0;
    } else {
      const vals = this.dayValues(o);
      const met = vs.filter((v) => (vals[v.id] ?? 0) >= v.target).length;
      const any = vs.some((v) => (vals[v.id] ?? 0) > 0);
      progress = Math.round((100 * met) / vs.length);
      status = progress >= 100 ? 'DONE' : any ? 'PARTIAL' : 'PENDING';
    }
    if (status === 'PENDING' && o.day < this.today()) status = 'MISSED';
    o.status = status;
    o.progress = progress;
  }

  private editable(o: Occurrence) {
    const t = this.today();
    if (o.day > t) return false;
    const c = this.checkin(o);
    if (c) return this.now().getTime() < new Date(c.createdAt).getTime() + EDIT_WINDOW_MS;
    return o.day >= S.addDays(t, -1);
  }

  private ensureEditable(o: Occurrence) {
    if (o.day > this.today()) throw new ServiceError('No se pueden registrar días futuros');
    if (!this.editable(o)) throw new ServiceError('Este registro ya no se puede editar (pasaron más de 24 h)');
  }

  private ensureCheckin(o: Occurrence): Checkin {
    if (!this.d.checkins[o.id]) {
      this.d.checkins[o.id] = { occurrenceId: o.id, createdAt: this.stamp(), editedAt: null, done: false, entries: [] };
    }
    return this.d.checkins[o.id];
  }

  private announce(o: Occurrence, before: Status) {
    if (o.status !== 'DONE' || before === 'DONE') return;
    const a = this.act(o.activityId);
    const streak = this.activityStreak(a.id);
    this.notice(`D${o.id}`, o.id, 'DONE', `${a.title} registrado`, `Lo marcaste a las ${hhmm(this.nowMin())}${streak > 1 ? `. Racha de ${streak} días.` : '.'}`);
  }

  // ---------------------------------------------------------------- choques

  private interval(o: Occurrence): E.TimeInterval {
    const a = this.act(o.activityId);
    return { id: String(o.id), start: o.startMin!, end: o.endMin!, rank: E.rankOf(a.kind === 'TASK', a.flexible, a.priority), flexible: a.flexible, parallel: a.parallel };
  }
  private static activeOcc(o: Occurrence) {
    return o.status !== 'DONE' && o.status !== 'SKIPPED' && o.status !== 'MISSED';
  }
  private ref(o: Occurrence): T.ConflictRef {
    return { occurrenceId: o.id, title: this.act(o.activityId).title, start: hhmm(o.startMin)!, end: hhmm(o.endMin)! };
  }

  private conflictsOfDay(day: string): Record<number, T.ConflictRef[]> {
    const list = this.dayOccs(day).filter((o) => o.startMin !== null && Local.activeOcc(o));
    const byId = new Map(list.map((o) => [String(o.id), o]));
    const out: Record<number, T.ConflictRef[]> = {};
    for (const c of E.findAll(list.map((o) => this.interval(o)))) {
      const x = byId.get(c.a.id)!;
      const y = byId.get(c.b.id)!;
      (out[x.id] ??= []).push(this.ref(y));
      (out[y.id] ??= []).push(this.ref(x));
    }
    return out;
  }

  // ---------------------------------------------------------------- tarjetas y detalle

  private card(o: Occurrence, conflicts?: Record<number, T.ConflictRef[]>): T.OccurrenceCard {
    const a = this.act(o.activityId);
    const mode = this.mode(a);
    const vals = this.dayValues(o);
    let counter: T.Counter | null = null;
    let subtitle: string;
    if (mode === 'COUNTER') {
      const v = this.varsOf(a)[0];
      const value = vals[v.id] ?? 0;
      counter = { variableId: v.id, name: v.name, unit: v.unit, value, target: v.target, step: v.step };
      subtitle = `${fmt(value)} de ${fmt(v.target)} ${v.name}`;
    } else if (mode === 'ROUTINE') {
      const groups = this.groupIds(a);
      const leaves = this.itemsOf(a).filter((i) => !groups.has(i.id));
      if (leaves.length === 1) {
        subtitle = this.varsOf(a).map((v) => `${fmt(vals[v.id] ?? 0)}/${fmt(v.target)} ${v.name}`).join(' · ');
      } else {
        const done = leaves.filter((i) => {
          const vs = this.d.variables.filter((v) => v.itemId === i.id);
          return vs.length > 0 && vs.every((v) => (vals[v.id] ?? 0) >= v.target);
        }).length;
        subtitle = `${a.routineName && a.routineName !== a.title ? `${a.routineName} · ` : ''}${done} de ${leaves.length} ítems`;
      }
    } else {
      subtitle =
        (a.kind === 'TASK' ? 'Tarea' : 'Hábito') +
        (o.startMin !== null ? ` · ${o.endMin! - o.startMin} min` : ' · todo el día') +
        (a.kind === 'TASK' && a.priority === 2 ? ' · prioridad alta' : '') +
        (a.kind === 'TASK' && !a.flexible ? ' · fija' : '');
    }
    const c = this.checkin(o);
    return {
      id: o.id,
      activityId: a.id,
      day: o.day,
      title: a.title,
      kind: a.kind,
      mode,
      start: hhmm(o.startMin),
      end: hhmm(o.endMin),
      status: o.status,
      progress: o.progress,
      fixed: !a.flexible,
      priority: a.priority,
      subtitle,
      counter,
      conflicts: (conflicts ?? this.conflictsOfDay(o.day))[o.id] ?? [],
      doneAt: o.status === 'DONE' && c ? c.editedAt ?? c.createdAt : null,
    };
  }

  private cardsOfDay(day: string): T.OccurrenceCard[] {
    const conflicts = this.conflictsOfDay(day);
    return this.dayOccs(day).map((o) => this.card(o, conflicts));
  }

  private series(v: Variable, from: string, to: string): S.DayValue[] {
    const byDay = new Map<string, number>();
    for (const o of this.d.occurrences) {
      if (o.day < from || o.day > to) continue;
      const c = this.d.checkins[o.id];
      if (!c) continue;
      const val = S.dailyValue(c.entries.filter((e) => e.variableId === v.id).map((e) => e.value), v.aggregation);
      if (val !== null) byDay.set(o.day, val);
    }
    return [...byDay.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([day, value]) => ({ day, value }));
  }

  private previousValue(v: Variable, day: string): number | null {
    const s = this.series(v, S.addDays(day, -60), S.addDays(day, -1));
    return s.length ? s[s.length - 1].value : null;
  }

  private detailOf(o: Occurrence): T.OccurrenceDetail {
    const a = this.act(o.activityId);
    const vals = this.dayValues(o);
    const groups = this.groupIds(a);
    const c = this.checkin(o);
    return {
      card: this.card(o),
      routineName: a.routineName,
      challengeDay: a.kind === 'TASK' ? null : S.daysBetween(a.challengeStart, o.day) + 1,
      challengeLength: a.challengeEnd ? S.daysBetween(a.challengeStart, a.challengeEnd) + 1 : null,
      items: this.itemsOf(a).map((i) => ({
        id: i.id,
        parentId: i.parentId,
        name: i.name,
        depth: i.depth,
        group: groups.has(i.id),
        variables: this.d.variables
          .filter((v) => v.itemId === i.id)
          .sort((x, y) => x.position - y.position)
          .map((v) => ({
            id: v.id,
            name: v.name,
            unit: v.unit,
            target: v.target,
            step: v.step,
            value: vals[v.id] ?? null,
            yesterday: this.previousValue(v, o.day),
            met: (vals[v.id] ?? -1) >= v.target,
            required: true,
          })),
      })),
      savedAt: c?.createdAt ?? null,
      editableUntil: c ? new Date(new Date(c.createdAt).getTime() + EDIT_WINDOW_MS).toISOString() : null,
      editable: this.editable(o),
    };
  }

  // ================================================================ API pública (mismo contrato)

  async todayView(): Promise<T.TodayView> {
    await this.tick();
    const t = this.today();
    const items = this.cardsOfDay(t);
    const now = this.nowMin();
    const current = items.find(
      (c) => c.start && c.status !== 'DONE' && c.status !== 'SKIPPED' && toMin(c.start)! <= now && now < toMin(c.end)!,
    );
    return {
      date: t,
      dayStart: hhmm(this.d.settings.dayStart)!,
      dayEnd: hhmm(this.d.settings.dayEnd)!,
      now: hhmm(now)!,
      doneCount: items.filter((c) => c.status === 'DONE').length,
      total: items.filter((c) => c.status !== 'SKIPPED').length,
      streak: S.currentStreak(this.globalOutcomes(400)),
      currentId: current?.id ?? null,
      items,
    };
  }

  async occurrence(id: number): Promise<T.OccurrenceDetail> {
    await this.tick();
    return this.detailOf(this.occ(id));
  }

  async saveCheckin(id: number, values: { variableId: number; value: number }[], done?: boolean): Promise<T.OccurrenceDetail> {
    const o = this.occ(id);
    this.ensureEditable(o);
    const a = this.act(o.activityId);
    const vars = this.varsOf(a);
    const existed = !!this.checkin(o);
    for (const { variableId, value } of values) {
      const v = vars.find((x) => x.id === variableId);
      if (!v) throw new ServiceError('La variable no pertenece a esta actividad');
      if (!(value >= 0) || !Number.isFinite(value)) throw new ServiceError(`«${v.name}» debe ser un número de 0 en adelante`);
    }
    const c = this.ensureCheckin(o);
    for (const { variableId, value } of values) {
      const v = vars.find((x) => x.id === variableId)!;
      c.entries = c.entries.filter((e) => e.variableId !== variableId);
      c.entries.push({ variableId, value, target: v.target, at: this.stamp() });
    }
    if (done !== undefined && done !== null) c.done = done;
    if (existed) c.editedAt = this.stamp();
    const before = o.status;
    if (o.status === 'SKIPPED') o.status = 'PENDING';
    this.recompute(o);
    this.announce(o, before);
    await this.commit();
    return this.detailOf(o);
  }

  async increment(id: number, variableId: number, amount: number): Promise<T.OccurrenceCard> {
    const o = this.occ(id);
    this.ensureEditable(o);
    const v = this.varsOf(this.act(o.activityId)).find((x) => x.id === variableId);
    if (!v) throw new ServiceError('La variable no pertenece a esta actividad');
    const c = this.ensureCheckin(o);
    if (amount > 0) c.entries.push({ variableId, value: amount, target: v.target, at: this.stamp() });
    else if (amount < 0) {
      const idx = c.entries.map((e) => e.variableId).lastIndexOf(variableId);
      if (idx >= 0) c.entries.splice(idx, 1);
      if (!c.entries.length && !c.done) delete this.d.checkins[o.id];
    }
    const before = o.status;
    this.recompute(o);
    this.announce(o, before);
    await this.commit();
    return this.card(o);
  }

  async undo(id: number): Promise<T.OccurrenceCard> {
    const o = this.occ(id);
    this.ensureEditable(o);
    delete this.d.checkins[o.id];
    o.status = 'PENDING';
    this.recompute(o);
    await this.commit();
    return this.card(o);
  }

  async skip(id: number): Promise<T.OccurrenceCard> {
    const o = this.occ(id);
    this.ensureEditable(o);
    delete this.d.checkins[o.id];
    o.status = 'SKIPPED';
    o.progress = 0;
    await this.commit();
    return this.card(o);
  }

  async resolution(id: number): Promise<T.Resolution> {
    const o = this.occ(id);
    const conflicts = this.conflictsOfDay(o.day)[o.id] ?? [];
    if (!conflicts.length) throw new ServiceError('Esta actividad ya no choca con otra');
    const involved = [o, ...conflicts.map((c) => this.occ(c.occurrenceId))];
    const target = involved.reduce((m, x) => {
      const rx = this.interval(x).rank;
      const rm = this.interval(m).rank;
      return rx < rm || (rx === rm && x.startMin! > m.startMin!) ? x : m;
    });
    const busy = this.dayOccs(o.day)
      .filter((x) => x.id !== target.id && x.startMin !== null && Local.activeOcc(x))
      .map((x) => this.interval(x));
    const dur = target.endMin! - target.startMin!;
    const notBefore = o.day === this.today() ? Math.ceil(this.nowMin() / 15) * 15 : 0;
    const st = E.nearestStart(busy, target.startMin!, dur, this.d.settings.dayStart, this.d.settings.dayEnd, notBefore);
    const ta = this.act(target.activityId);
    const other = involved.find((x) => x.id !== target.id)!;
    const oa = this.act(other.activityId);
    const bothFixed = involved.every((x) => !this.act(x.activityId).flexible);
    let reason: string;
    if (st === null) reason = `No queda un hueco libre de ${dur} min hoy. Puedes marcarla como descanso.`;
    else if (bothFixed) reason = `Las dos son fijas. Te sugerimos mover «${ta.title}», que tiene menor prioridad.`;
    else {
      const why = oa.kind === 'TASK' && !oa.flexible ? `es fija y de prioridad ${PRIORITY[oa.priority]}` : 'tiene más prioridad';
      reason = `«${oa.title}» ${why}, así que te sugerimos mover «${ta.title}».`;
    }
    return {
      moveOccurrenceId: target.id,
      moveTitle: ta.title,
      from: hhmm(target.startMin)!,
      proposal: st === null ? null : { start: hhmm(st)!, end: hhmm(st + dur)! },
      reason,
      conflicts,
    };
  }

  async move(id: number, start: string): Promise<T.TodayView> {
    const o = this.occ(id);
    if (o.startMin === null) throw new ServiceError('Las actividades de todo el día no tienen hora');
    if (o.day < this.today()) throw new ServiceError('No se pueden mover días pasados');
    const s = toMin(start)!;
    const dur = o.endMin! - o.startMin;
    if (s < this.d.settings.dayStart || s + dur > this.d.settings.dayEnd) {
      throw new ServiceError(`La hora debe quedar entre ${hhmm(this.d.settings.dayStart)} y ${hhmm(this.d.settings.dayEnd)}`);
    }
    o.movedFrom ??= o.startMin;
    o.startMin = s;
    o.endMin = s + dur;
    await this.commit();
    return this.todayView();
  }

  async day(date: string): Promise<T.DaySummary> {
    await this.tick();
    const items = this.cardsOfDay(date);
    return {
      date,
      done: items.filter((c) => c.status === 'DONE').length,
      partial: items.filter((c) => c.status === 'PARTIAL').length,
      missed: items.filter((c) => c.status === 'MISSED').length,
      total: items.filter((c) => c.status !== 'SKIPPED').length,
      editableUntil: this.at(S.addDays(date, 2), 0).toISOString(),
      items,
    };
  }

  // ---------------------------------------------------------------- actividades

  private summary(a: Activity): T.ActivitySummary {
    return {
      id: a.id,
      kind: a.kind,
      title: a.title,
      goal: a.goal,
      daysMask: a.daysMask,
      taskDate: a.taskDate,
      start: hhmm(a.start),
      durationMin: a.durationMin,
      flexible: a.flexible,
      priority: a.priority,
      status: a.status,
      challengeStart: a.challengeStart,
      challengeEnd: a.challengeEnd,
      routineName: a.routineName,
      variableCount: this.varsOf(a).length,
    };
  }

  async activities(): Promise<T.ActivitySummary[]> {
    return this.d.activities.map((a) => this.summary(a));
  }

  async createActivity(b: T.ActivityInput): Promise<T.ActivitySummary> {
    const kind = b.kind ?? 'HABIT';
    const title = (b.title ?? '').trim();
    if (!title || title.length > 120) throw new ServiceError('Escribe un nombre de hasta 120 caracteres');
    const mask = b.daysMask ?? 127;
    if (kind === 'HABIT' && (mask < 1 || mask > 127)) throw new ServiceError('Elige al menos un día de la semana');
    const t = this.today();
    if (kind === 'TASK' && (!b.taskDate || b.taskDate < t)) throw new ServiceError('La tarea necesita una fecha de hoy en adelante');
    const dur = b.durationMin ?? 30;
    if (dur < 5 || dur > 960) throw new ServiceError('La duración debe estar entre 5 y 960 minutos');
    const start = toMin(b.start ?? null);
    const s = this.d.settings;
    if (start !== null && (start < s.dayStart || start + dur > s.dayEnd)) {
      throw new ServiceError(`La actividad debe quedar entre ${hhmm(s.dayStart)} y ${hhmm(s.dayEnd)}`);
    }
    const priority = b.priority ?? 1;
    if (![0, 1, 2].includes(priority)) throw new ServiceError('La prioridad debe ser baja, media o alta');
    if (b.challengeDays != null && (b.challengeDays < 1 || b.challengeDays > 3650)) {
      throw new ServiceError('La duración del reto debe estar entre 1 y 3650 días');
    }

    // Validar la rutina completa antes de escribir nada.
    const checkVars = (vs: T.VariableInput[] = []) =>
      vs.forEach((v) => {
        const n = (v.name ?? '').trim();
        if (!n || n.length > 60) throw new ServiceError('Cada variable necesita un nombre de hasta 60 caracteres');
        if (!(v.target > 0)) throw new ServiceError(`La meta de «${n}» debe ser mayor que 0`);
      });
    const checkItems = (items: T.ItemInput[] = [], depth = 1) =>
      items.forEach((it) => {
        if (depth > MAX_DEPTH) throw new ServiceError('Las subactividades se pueden anidar hasta 3 niveles');
        if (!(it.name ?? '').trim()) throw new ServiceError('Cada subactividad necesita un nombre');
        if (it.children?.length && it.variables?.length) throw new ServiceError(`«${it.name}» agrupa subactividades: las variables van dentro de ellas`);
        checkVars(it.variables);
        checkItems(it.children, depth + 1);
      });
    checkVars(b.variables);
    checkItems(b.items);

    let routineId: number | null = null;
    if (b.items?.length || b.variables?.length) {
      routineId = this.db.nextId();
      let pos = 0;
      const addVars = (itemId: number, vs: T.VariableInput[] = []) =>
        vs.forEach((v, i) =>
          this.d.variables.push({
            id: this.db.nextId(),
            itemId,
            name: v.name.trim(),
            unit: v.unit?.trim() || null,
            target: v.target,
            step: v.step && v.step > 0 ? v.step : 1,
            aggregation: v.aggregation ?? 'SUM',
            position: i,
          }),
        );
      const addItem = (it: T.ItemInput, parentId: number | null, depth: number) => {
        const item: Item = { id: this.db.nextId(), routineId: routineId!, parentId, name: it.name.trim(), position: pos++, depth, required: it.required ?? true };
        this.d.items.push(item);
        it.children?.forEach((ch) => addItem(ch, item.id, depth + 1));
        addVars(item.id, it.variables);
      };
      if (b.items?.length) b.items.forEach((it) => addItem(it, null, 1));
      else addItem({ name: title, variables: b.variables }, null, 1);
    }

    const a: Activity = {
      id: this.db.nextId(),
      kind,
      title,
      goal: b.goal?.trim() || null,
      daysMask: kind === 'HABIT' ? mask : 127,
      taskDate: kind === 'TASK' ? b.taskDate! : null,
      start,
      durationMin: dur,
      flexible: b.flexible ?? true,
      parallel: !!b.parallel,
      priority,
      challengeStart: t,
      challengeEnd: kind === 'HABIT' && b.challengeDays ? S.addDays(t, b.challengeDays - 1) : null,
      status: 'ACTIVE',
      routineId,
      routineName: routineId !== null ? title : null,
      createdAt: this.stamp(),
    };
    this.d.activities.push(a);
    this.generate(a, t, S.addDays(t, HORIZON_DAYS - 1));
    const mine = this.d.occurrences.filter((o) => o.activityId === a.id);
    for (const o of mine) {
      const c = this.conflictsOfDay(o.day)[o.id];
      if (c?.length) {
        this.notice(`C${a.id}`, o.id, 'CONFLICT', `${title} choca con otra actividad`, `Choca con «${c[0].title}» (${c[0].start} – ${c[0].end}). Revísalo en Hoy.`);
        break;
      }
    }
    await this.commit();
    return this.summary(a);
  }

  async setActivityStatus(id: number, status: string): Promise<T.ActivitySummary> {
    const a = this.act(id);
    if (!['ACTIVE', 'PAUSED', 'ENDED'].includes(status)) throw new ServiceError('Estado inválido');
    a.status = status as Activity['status'];
    const t = this.today();
    if (status === 'ACTIVE') this.generate(a, t, S.addDays(t, HORIZON_DAYS - 1));
    else this.d.occurrences = this.d.occurrences.filter((o) => !(o.activityId === a.id && o.day > t && o.status === 'PENDING' && !this.d.checkins[o.id]));
    await this.commit();
    return this.summary(a);
  }

  async checkSchedule(b: { kind: string; daysMask?: number; taskDate?: string | null; start: string; durationMin: number }): Promise<T.ScheduleCheck> {
    const start = toMin(b.start);
    if (start === null) return { conflicts: [], suggestion: null };
    const dur = b.durationMin ?? 30;
    const t = this.today();
    const conflicts: T.ScheduleCheck['conflicts'] = [];
    const busy: E.TimeInterval[] = [];
    const candidate: E.TimeInterval = { id: 'new', start, end: start + dur, rank: 0, flexible: true, parallel: false };
    for (let k = 0; k < HORIZON_DAYS; k++) {
      const day = S.addDays(t, k);
      const applies = b.kind === 'TASK' ? day === b.taskDate : S.includesDay(b.daysMask ?? 127, day);
      if (!applies) continue;
      const dayBusy = this.dayOccs(day)
        .filter((o) => o.startMin !== null && o.status !== 'SKIPPED')
        .map((o) => this.interval(o))
        .sort((x, y) => x.start - y.start);
      for (const hit of E.conflictsOf(dayBusy, candidate)) {
        conflicts.push({ date: day, title: this.act(this.occ(Number(hit.id)).activityId).title, start: hhmm(hit.start)!, end: hhmm(hit.end)! });
      }
      busy.push(...dayBusy);
    }
    let suggestion: T.Slot | null = null;
    if (conflicts.length) {
      const onlyToday = conflicts.every((c) => c.date === t);
      const st = E.nearestStart(busy, start, dur, this.d.settings.dayStart, this.d.settings.dayEnd, onlyToday ? this.nowMin() : 0);
      suggestion = st === null ? null : { start: hhmm(st)!, end: hhmm(st + dur)! };
    }
    return { conflicts, suggestion };
  }

  // ---------------------------------------------------------------- historial y tablero

  async progress(variableId: number, days: number): Promise<T.Progress> {
    if (![7, 30, 90].includes(days)) throw new ServiceError('El rango debe ser 7, 30 o 90 días');
    const v = this.d.variables.find((x) => x.id === variableId);
    if (!v) throw new ServiceError('La variable no existe');
    const item = this.d.items.find((i) => i.id === v.itemId)!;
    const a = this.d.activities.find((x) => x.routineId === item.routineId)!;
    const t = this.today();
    const all = this.series(v, '2000-01-01', t);
    const sum = S.summarize(all, t, days, 10);
    const byDay = new Map(all.map((d) => [d.day, d.value]));
    const series: T.DayValue[] = [];
    for (let day = S.addDays(t, -(days - 1)); day <= t; day = S.addDays(day, 1)) series.push({ date: day, value: byDay.get(day) ?? null });
    return {
      variableId: v.id,
      name: v.name,
      unit: v.unit,
      itemName: item.name,
      activityId: a.id,
      activityTitle: a.title,
      siblings: this.d.variables.filter((x) => x.itemId === v.itemId).sort((x, y) => x.position - y.position).map((x) => ({ id: x.id, name: x.name, unit: x.unit })),
      days,
      today: sum.today,
      yesterday: sum.previous ? { date: sum.previous.day, value: sum.previous.value } : null,
      average: sum.average,
      best: sum.best ? { date: sum.best.day, value: sum.best.value } : null,
      recordCount: series.filter((d) => d.value !== null).length,
      series,
      records: sum.records.map((r) => ({ date: r.day, value: r.value, diff: r.diff })),
    };
  }

  private dayStats(day: string) {
    const list = this.dayOccs(day);
    if (!list.length) return null;
    const counted = list.filter((o) => o.status !== 'SKIPPED');
    return {
      pct: counted.length ? counted.reduce((s, o) => s + o.progress, 0) / counted.length : 0,
      total: list.length,
      ok: list.filter((o) => o.status === 'DONE' || o.status === 'PARTIAL').length,
      missed: list.filter((o) => o.status === 'MISSED').length,
      skipped: list.filter((o) => o.status === 'SKIPPED').length,
    };
  }

  private outcomeOfDay(day: string): S.Outcome {
    const r = this.dayStats(day);
    if (!r) return 'NONE';
    if (r.total === r.skipped) return 'SKIPPED';
    if (r.missed > 0) return 'MISSED';
    if (r.ok > 0) return r.ok + r.skipped === r.total ? 'DONE' : 'PARTIAL';
    return 'MISSED';
  }

  private globalOutcomes(days: number): S.Outcome[] {
    const t = this.today();
    const out: S.Outcome[] = [];
    for (let day = S.addDays(t, -days); day <= t; day = S.addDays(day, 1)) out.push(this.outcomeOfDay(day));
    return out;
  }

  private activityStreak(activityId: number): number {
    const t = this.today();
    const seq = this.d.occurrences
      .filter((o) => o.activityId === activityId && o.day <= t)
      .sort((x, y) => (x.day < y.day ? -1 : 1))
      .map((o) => (o.status === 'PENDING' ? 'MISSED' : o.status) as S.Outcome);
    return S.currentStreak(seq);
  }

  async dashboard(): Promise<T.Dashboard> {
    await this.tick();
    const t = this.today();
    const monday = S.addDays(t, -S.weekday(t));
    const heatmap: T.HeatCell[] = [];
    for (let day = S.addDays(monday, -7 * 19); day < S.addDays(monday, 7); day = S.addDays(day, 1)) {
      const pct = day <= t ? this.dayStats(day)?.pct ?? 0 : 0;
      heatmap.push({ date: day, pct: Math.round(pct * 10) / 10, level: S.heatLevel(pct), future: day > t });
    }
    const week: number[] = [];
    for (let day = monday; day <= t; day = S.addDays(day, 1)) {
      const r = this.dayStats(day);
      if (r) week.push(r.pct);
    }
    const outcomes = this.globalOutcomes(400);
    const challenges = this.d.activities
      .filter((a) => a.kind === 'HABIT' && a.status === 'ACTIVE')
      .map((a) => {
        const occ = this.d.occurrences.filter((o) => o.activityId === a.id && o.day <= t).sort((x, y) => (x.day < y.day ? -1 : 1));
        const counted = occ.filter((o) => o.status !== 'SKIPPED' && !(o.day === t && o.status === 'PENDING'));
        const ok = occ.filter((o) => o.status === 'DONE' || o.status === 'PARTIAL').length;
        const byDay = new Map(occ.map((o) => [o.day, o.status]));
        const last14: T.Challenge['last14'] = [];
        for (let day = S.addDays(t, -13); day <= t; day = S.addDays(day, 1)) last14.push(byDay.get(day) ?? 'NONE');
        return {
          activityId: a.id,
          title: a.title,
          goal: a.goal ?? this.describe(a),
          day: S.daysBetween(a.challengeStart, t) + 1,
          of: a.challengeEnd ? S.daysBetween(a.challengeStart, a.challengeEnd) + 1 : null,
          streak: this.activityStreak(a.id),
          rate: counted.length ? Math.round((100 * ok) / counted.length) : 0,
          last14,
        };
      });
    return {
      streak: S.currentStreak(outcomes),
      bestStreak: S.bestStreak(outcomes),
      weekPct: week.length ? Math.round(week.reduce((s, x) => s + x, 0) / week.length) : 0,
      todayPct: Math.round(this.dayStats(t)?.pct ?? 0),
      totalCheckins: Object.keys(this.d.checkins).length,
      heatmap,
      challenges,
    };
  }

  private describe(a: Activity): string | null {
    const vs = this.varsOf(a);
    const m = this.mode(a);
    if (m === 'COUNTER') return `${fmt(vs[0].target)} ${vs[0].name} por día`;
    if (m === 'ROUTINE') {
      const n = this.itemsOf(a).length - this.groupIds(a).size;
      return n === 1 ? vs.map((v) => `${fmt(v.target)} ${v.name}`).join(' · ') : `${n} subactividades`;
    }
    return null;
  }

  // ---------------------------------------------------------------- bandeja y ajustes

  async notifications(): Promise<T.NotificationView[]> {
    await this.tick();
    return this.d.notices.slice(0, 60).map(({ key: _k, ...n }) => n);
  }

  async markRead(): Promise<void> {
    let changed = false;
    this.d.notices.forEach((n) => {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (changed) await this.db.save();
  }

  async settings(): Promise<T.SettingsView> {
    const s = this.d.settings;
    return { dayStart: hhmm(s.dayStart)!, dayEnd: hhmm(s.dayEnd)!, nudgeMinutes: s.nudgeMinutes, summaryTime: hhmm(s.summaryMin)! };
  }

  // ---------------------------------------------------------------- avisos del teléfono

  /** Avisos de los próximos 7 días: recordatorio, "+N min" y resumen; y uno para volver a abrir la app. */
  planned(): Planned[] {
    const now = this.now();
    const t = this.today();
    const s = this.d.settings;
    const out: Planned[] = [];
    for (const o of this.d.occurrences) {
      if (o.day < t || o.day > S.addDays(t, HORIZON_DAYS - 1) || o.startMin === null) continue;
      const a = this.act(o.activityId);
      if (a.status !== 'ACTIVE' || (o.status !== 'PENDING' && o.status !== 'PARTIAL')) continue;
      const hasRecord = !!this.checkin(o);
      const reminder = this.at(o.day, o.startMin);
      const nudge = this.at(o.day, o.startMin + s.nudgeMinutes);
      const routine = a.routineName && a.routineName !== a.title ? ` · ${a.routineName}` : '';
      // Recordatorio: mientras no esté hecha. "+N min": solo si todavía no hay ningún registro.
      if (reminder > now) out.push({ id: o.id * 10 + 1, title: `Es hora de ${a.title}`, body: `${hhmm(o.startMin)} – ${hhmm(o.endMin)}${routine}`, at: reminder, url: `/actividad/${o.id}` });
      if (nudge > now && !hasRecord) out.push({ id: o.id * 10 + 2, title: `${a.title} empezó hace ${s.nudgeMinutes} min`, body: 'Todavía no hay registro. Toca para marcar tu avance.', at: nudge, url: `/actividad/${o.id}` });
    }
    for (let k = 0; k < HORIZON_DAYS; k++) {
      const day = S.addDays(t, k);
      const when = this.at(day, s.summaryMin);
      if (when <= now || !this.dayOccs(day).length) continue;
      const sum = k === 0 ? this.summaryText(day) : { title: 'Resumen del día', body: 'Revisa cómo te fue hoy y lo que quedó pendiente.' };
      if (sum) out.push({ id: 2_000_000 + k, title: sum.title, body: sum.body, at: when, url: '/' });
    }
    if (this.d.activities.some((a) => a.status === 'ACTIVE')) {
      out.push({ id: 2_100_000, title: 'Abre Constancia', body: 'Ábrela para seguir recibiendo tus recordatorios de la semana.', at: this.at(S.addDays(t, HORIZON_DAYS), 20 * 60), url: '/' });
    }
    return out.sort((x, y) => x.at.getTime() - y.at.getTime());
  }

  // ---------------------------------------------------------------- respaldo

  exportJson(): string {
    return JSON.stringify({ ...this.d, exportedAt: this.stamp() }, null, 1);
  }

  async importJson(text: string): Promise<{ activities: number; checkins: number }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ServiceError('El archivo no es un respaldo válido');
    }
    if (!isData(parsed)) throw new ServiceError('El archivo no es un respaldo de Constancia');
    const { exportedAt: _e, ...data } = parsed as Data & { exportedAt?: string };
    data.lastTick = this.stamp();
    await this.db.replace(data as Data);
    await this.tick();
    this.onChange();
    return { activities: data.activities.length, checkins: Object.keys(data.checkins).length };
  }
}
