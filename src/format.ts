const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-10-20" → Date en UTC (sin corrimientos por zona horaria). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Martes 20 de octubre" */
export function longDate(iso: string): string {
  const d = parseDay(iso);
  const day = DAYS[d.getUTCDay()];
  return `${day[0].toUpperCase()}${day.slice(1)} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

/** "lun 19 oct" */
export function shortDate(iso: string): string {
  const d = parseDay(iso);
  return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** "19 oct" */
export function dayMonth(iso: string): string {
  const d = parseDay(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** Hoy / Ayer / "lun 19 oct" respecto de una fecha de referencia. */
export function relativeDay(iso: string, today: string): string {
  if (iso === today) return 'Hoy';
  if (iso === addDays(today, -1)) return 'Ayer';
  return shortDate(iso);
}

/** 40 → "40", 37.5 → "37,5" */
export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
}

export function withUnit(v: number | null | undefined, unit: string | null | undefined): string {
  const n = num(v);
  return unit && n !== '—' ? `${n} ${unit}` : n;
}

/** +2,5 / −1 / ±0 */
export function signed(v: number | null | undefined, unit?: string | null): string {
  if (v === null || v === undefined) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${sign}${num(Math.abs(v))}${unit ? ` ${unit}` : ''}`;
}

/** Hora local "HH:mm" de un instante ISO. */
export function clock(isoInstant: string): string {
  const d = new Date(isoInstant);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export const WEEKDAYS = [
  { letter: 'L', name: 'Lunes' },
  { letter: 'M', name: 'Martes' },
  { letter: 'X', name: 'Miércoles' },
  { letter: 'J', name: 'Jueves' },
  { letter: 'V', name: 'Viernes' },
  { letter: 'S', name: 'Sábado' },
  { letter: 'D', name: 'Domingo' },
];
