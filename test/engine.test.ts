import { describe, expect, it } from 'vitest';
import { conflictsOf, findAll, freeSlots, nearestStart, rankOf, resolveDay, type TimeInterval } from '../src/engine/intervals';
import { bestStreak, currentStreak, dailyValue, heatLevel, includesDay, summarize } from '../src/engine/stats';

const t = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const block = (id: string, from: string, to: string, isTask = false, flexible = false, priority = 1): TimeInterval => ({
  id,
  start: t(from),
  end: t(to),
  rank: rankOf(isTask, flexible, priority),
  flexible,
  parallel: false,
});

describe('motor de conflictos', () => {
  it('detecta solo los pares que se solapan', () => {
    const c = findAll([
      block('meditar', '08:30', '08:45'),
      block('ejercicio', '09:00', '10:00'),
      block('ingles', '18:00', '18:30', false, true),
      block('banco', '18:15', '18:30', true, false, 2),
    ]);
    expect(c.map((x) => [x.a.id, x.b.id])).toEqual([['ingles', 'banco']]);
  });

  it('bloques que se tocan o paralelos no chocan', () => {
    expect(findAll([block('a', '09:00', '10:00'), block('b', '10:00', '10:30')])).toEqual([]);
    expect(findAll([block('a', '07:00', '08:00'), { ...block('p', '07:00', '07:30'), parallel: true }])).toEqual([]);
  });

  it('encuentra todos los choques de un bloque largo con varios cortos', () => {
    const c = findAll([block('largo', '09:00', '12:00'), block('x', '09:30', '10:00'), block('y', '11:00', '11:30'), block('z', '12:00', '12:30')]);
    expect(c.length).toBe(2);
  });

  it('búsqueda binaria de choques de un candidato', () => {
    const sorted = [block('a', '08:00', '09:00'), block('b', '12:00', '13:00'), block('c', '18:15', '18:30'), block('d', '20:00', '21:00')];
    expect(conflictsOf(sorted, block('x', '18:00', '18:30')).map((i) => i.id)).toEqual(['c']);
  });

  it('huecos libres y hueco más cercano', () => {
    const busy = [block('a', '09:00', '10:00'), block('b', '09:30', '11:00')];
    expect(freeSlots(busy, t('08:00'), t('24:00'))).toEqual([
      { start: t('08:00'), end: t('09:00') },
      { start: t('11:00'), end: t('24:00') },
    ]);
    expect(nearestStart([block('banco', '18:15', '18:30')], t('18:00'), 30, t('08:00'), t('24:00'))).toBe(t('18:30'));
    expect(nearestStart([block('noche', '18:15', '24:00')], t('18:00'), 30, t('08:00'), t('24:00'))).toBe(t('17:45'));
    expect(nearestStart([block('todo', '08:00', '23:00')], t('10:00'), 90, t('08:00'), t('24:00'), t('23:00'))).toBeNull();
  });

  it('resuelve moviendo el flexible y deja dos fijos al usuario', () => {
    const plan = resolveDay([block('ingles', '18:00', '18:30', false, true), block('banco', '18:15', '18:30', true, false, 2)], t('08:00'), t('24:00'));
    expect(plan.moves).toEqual([{ id: 'ingles', fromStart: t('18:00'), toStart: t('18:30'), toEnd: t('19:00') }]);
    const fixed = resolveDay([block('a', '10:00', '11:00'), block('b', '10:30', '11:30', true)], t('08:00'), t('24:00'));
    expect(fixed.moves).toEqual([]);
    expect(fixed.pending[0].interval.id).toBe('a');
  });

  it('un día lleno se resuelve rápido', () => {
    const day = Array.from({ length: 80 }, (_, i) => {
      const s = t('08:00') + (i % 30) * 30;
      return { id: `x${i}`, start: s, end: s + 15, rank: rankOf(false, i % 2 === 0, 1), flexible: i % 2 === 0, parallel: false };
    });
    const t0 = performance.now();
    const plan = resolveDay(day, t('08:00'), t('24:00'));
    expect(performance.now() - t0).toBeLessThan(200);
    expect(plan.moves.length).toBeGreaterThan(0);
  });
});

describe('estadísticas', () => {
  it('agrega el valor del día', () => {
    expect(dailyValue([1, 3, 2], 'SUM')).toBe(6);
    expect(dailyValue([1, 3, 2], 'MAX')).toBe(3);
    expect(dailyValue([1, 3, 2], 'LAST')).toBe(2);
    expect(dailyValue([], 'SUM')).toBeNull();
  });

  it('compara hoy con el anterior, el promedio y la mejor marca', () => {
    const s = summarize(
      [
        { day: '2026-10-11', value: 45 },
        { day: '2026-10-15', value: 32.5 },
        { day: '2026-10-17', value: 35 },
        { day: '2026-10-19', value: 37.5 },
        { day: '2026-10-20', value: 40 },
      ],
      '2026-10-20',
      7,
      7,
    );
    expect(s.today).toBe(40);
    expect(s.previous?.day).toBe('2026-10-19');
    expect(s.average).toBeCloseTo((32.5 + 35 + 37.5) / 3);
    expect(s.best?.value).toBe(45);
    expect(s.records[0]).toEqual({ day: '2026-10-20', value: 40, diff: 2.5 });
    expect(s.records.at(-1)?.diff).toBeNull();
  });

  it('rachas: el descanso no rompe y hoy abierto tampoco', () => {
    const days = ['MISSED', 'DONE', 'SKIPPED', 'PARTIAL', 'DONE', 'MISSED'] as const;
    expect(currentStreak([...days])).toBe(3);
    expect(currentStreak([...days], true)).toBe(0);
    expect(bestStreak([...days])).toBe(3);
  });

  it('niveles del heatmap y días de la semana', () => {
    expect([0, 10, 40, 70, 100].map(heatLevel)).toEqual([0, 1, 2, 3, 4]);
    const lunMarJue = 0b0001011;
    expect(includesDay(lunMarJue, '2026-10-20')).toBe(true); // martes
    expect(includesDay(lunMarJue, '2026-10-21')).toBe(false); // miércoles
  });
});
