/**
 * Motor de conflictos sobre un grafo de intervalos.
 *
 * Cada actividad del día es un intervalo [start, end) en minutos desde las 00:00. Como es una sola
 * persona, el grafo de choques es un grafo de intervalos: se resuelve con barridos ordenados en
 * O(n log n), sin backtracking.
 */

export interface TimeInterval {
  id: string;
  start: number;
  end: number;
  /** Rango de permanencia: más alto = más difícil de mover. */
  rank: number;
  flexible: boolean;
  /** Puede convivir con otro bloque al mismo tiempo (por ejemplo, un pódcast mientras caminas). */
  parallel: boolean;
}

export interface Conflict {
  a: TimeInterval;
  b: TimeInterval;
}

export interface Slot {
  start: number;
  end: number;
}

/** Tarea fija > hábito fijo > flexible; luego la prioridad (0 baja, 1 media, 2 alta). */
export function rankOf(isTask: boolean, flexible: boolean, priority: number): number {
  const tier = flexible ? 0 : isTask ? 2 : 1;
  return tier * 10 + priority;
}

export function conflictsWith(a: TimeInterval, b: TimeInterval): boolean {
  if (a.parallel || b.parallel) return false;
  return a.start < b.end && b.start < a.end;
}

/** Todos los choques del día con un barrido: O(n log n + k). */
export function findAll(intervals: TimeInterval[]): Conflict[] {
  const sorted = [...intervals].sort((x, y) => x.start - y.start || x.end - y.end);
  const active: TimeInterval[] = []; // ordenado por fin
  const out: Conflict[] = [];
  for (const current of sorted) {
    while (active.length && active[0].end <= current.start) active.shift();
    for (const open of active) {
      if (conflictsWith(open, current)) out.push({ a: open, b: current });
    }
    let i = active.length;
    while (i > 0 && active[i - 1].end > current.end) i--;
    active.splice(i, 0, current);
  }
  return out;
}

/**
 * Choques de un candidato contra una lista ordenada por inicio. La búsqueda binaria descarta los
 * bloques que empiezan después de que termina el candidato.
 */
export function conflictsOf(sortedByStart: TimeInterval[], candidate: TimeInterval): TimeInterval[] {
  let lo = 0;
  let hi = sortedByStart.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedByStart[mid].start < candidate.end) lo = mid + 1;
    else hi = mid;
  }
  const out: TimeInterval[] = [];
  for (let i = 0; i < lo; i++) {
    const other = sortedByStart[i];
    if (other.id !== candidate.id && conflictsWith(other, candidate)) out.push(other);
  }
  return out;
}

/** Huecos libres entre dayStart y dayEnd, sin contar los bloques paralelos. */
export function freeSlots(busy: TimeInterval[] | Slot[], dayStart: number, dayEnd: number): Slot[] {
  const sorted = (busy as (TimeInterval | Slot)[])
    .filter((b) => !('parallel' in b && b.parallel))
    .sort((x, y) => x.start - y.start);
  const slots: Slot[] = [];
  let cursor = dayStart;
  for (const b of sorted) {
    if (b.start > cursor) slots.push({ start: cursor, end: Math.min(b.start, dayEnd) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) slots.push({ start: cursor, end: dayEnd });
  return slots.filter((s) => s.end > s.start);
}

/**
 * Inicio del hueco válido más cercano hacia adelante desde `desired`; si no hay, el más cercano hacia
 * atrás. Nunca antes de `notBefore` (por ejemplo, la hora actual).
 */
export function nearestStart(
  busy: TimeInterval[] | Slot[],
  desired: number,
  duration: number,
  dayStart: number,
  dayEnd: number,
  notBefore = 0,
): number | null {
  let forward: number | null = null;
  let backward: number | null = null;
  for (const slot of freeSlots(busy, Math.max(dayStart, notBefore), dayEnd)) {
    if (slot.end - slot.start < duration) continue;
    const latest = slot.end - duration;
    if (latest >= desired) {
      const c = Math.max(slot.start, desired);
      if (forward === null || c < forward) forward = c;
    } else if (backward === null || latest > backward) {
      backward = latest;
    }
  }
  return forward ?? backward;
}

export interface Move {
  id: string;
  fromStart: number;
  toStart: number;
  toEnd: number;
}

export interface Plan {
  moves: Move[];
  pending: { interval: TimeInterval; blockers: TimeInterval[] }[];
  budgetExceeded: boolean;
}

/**
 * Resolución voraz de un día: se ubican primero los de mayor rango; un flexible que choca se mueve
 * al hueco libre más cercano; uno fijo queda para que decida el usuario. Presupuesto de 50 ms.
 */
export function resolveDay(day: TimeInterval[], dayStart: number, dayEnd: number, notBefore = 0, budgetMs = 50): Plan {
  const t0 = Date.now();
  const ordered = [...day].sort((x, y) => y.rank - x.rank || x.start - y.start);
  const placed: TimeInterval[] = [];
  const plan: Plan = { moves: [], pending: [], budgetExceeded: false };
  for (const current of ordered) {
    if (Date.now() - t0 > budgetMs) plan.budgetExceeded = true;
    const sorted = [...placed].sort((x, y) => x.start - y.start);
    const blockers = conflictsOf(sorted, current);
    if (!blockers.length) {
      placed.push(current);
      continue;
    }
    if (current.flexible && !plan.budgetExceeded) {
      const start = nearestStart(placed, current.start, current.end - current.start, dayStart, dayEnd, notBefore);
      if (start !== null) {
        const moved = { ...current, start, end: start + (current.end - current.start) };
        placed.push(moved);
        plan.moves.push({ id: current.id, fromStart: current.start, toStart: moved.start, toEnd: moved.end });
        continue;
      }
    }
    plan.pending.push({ interval: current, blockers });
    placed.push(current);
  }
  return plan;
}
