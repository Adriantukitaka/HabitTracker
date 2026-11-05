/** Historial de una variable: valor del día, anterior, promedio, mejor marca y rachas. */

export type Aggregation = 'SUM' | 'MAX' | 'LAST';
export type Outcome = 'DONE' | 'PARTIAL' | 'MISSED' | 'SKIPPED' | 'NONE';

export interface DayValue {
  day: string;
  value: number;
}

export interface RecordRow {
  day: string;
  value: number;
  diff: number | null;
}

export interface Summary {
  today: number | null;
  previous: DayValue | null;
  average: number | null;
  best: DayValue | null;
  records: RecordRow[];
}

/** Combina los registros de un día (en orden de guardado). */
export function dailyValue(values: number[], aggregation: Aggregation): number | null {
  if (!values.length) return null;
  if (aggregation === 'MAX') return Math.max(...values);
  if (aggregation === 'LAST') return values[values.length - 1];
  return values.reduce((s, v) => s + v, 0);
}

/**
 * @param series días con registro, en orden ascendente ("yyyy-mm-dd")
 * @param windowDays el promedio usa los días con registro de esta ventana, sin contar hoy
 */
export function summarize(series: DayValue[], today: string, windowDays: number, maxRecords: number): Summary {
  const windowStart = addDays(today, -(windowDays - 1));
  let todayValue: number | null = null;
  let previous: DayValue | null = null;
  let best: DayValue | null = null;
  let sum = 0;
  let count = 0;
  const recorded = series.filter((d) => d.day <= today);
  for (const d of recorded) {
    if (d.day === today) todayValue = d.value;
    else {
      previous = d;
      if (d.day >= windowStart) {
        sum += d.value;
        count++;
      }
    }
    if (!best || d.value >= best.value) best = d;
  }
  const records: RecordRow[] = [];
  for (let i = recorded.length - 1; i >= 0 && records.length < maxRecords; i--) {
    records.push({ day: recorded[i].day, value: recorded[i].value, diff: i > 0 ? recorded[i].value - recorded[i - 1].value : null });
  }
  return { today: todayValue, previous, average: count ? sum / count : null, best, records };
}

/**
 * Racha actual desde el último elemento (hoy). Hecho y parcial suman; descanso y días vacíos no suman
 * ni rompen; "no hecho" rompe. Hoy, mientras siga abierto, nunca rompe.
 */
export function currentStreak(ascending: Outcome[], todayClosed = false): number {
  let streak = 0;
  for (let i = ascending.length - 1; i >= 0; i--) {
    const o = ascending[i];
    if (o === 'DONE' || o === 'PARTIAL') streak++;
    else if (o === 'MISSED') {
      if (i === ascending.length - 1 && !todayClosed) continue;
      break;
    }
  }
  return streak;
}

export function bestStreak(ascending: Outcome[]): number {
  let best = 0;
  let run = 0;
  for (const o of ascending) {
    if (o === 'DONE' || o === 'PARTIAL') best = Math.max(best, ++run);
    else if (o === 'MISSED') run = 0;
  }
  return best;
}

/** Nivel 0–4 del heatmap según el porcentaje de avance del día. */
export function heatLevel(pct: number): number {
  if (pct <= 0) return 0;
  if (pct < 25) return 1;
  if (pct < 50) return 2;
  if (pct < 85) return 3;
  return 4;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** Lunes = 0 … domingo = 6. */
export function weekday(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function includesDay(mask: number, day: string): boolean {
  return (mask & (1 << weekday(day))) !== 0;
}
