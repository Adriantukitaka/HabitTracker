import { vi } from 'vitest';
import { Db, MemoryStorage } from '../src/local/db';
import { Local } from '../src/local/service';
import { addDays } from '../src/engine/stats';

/** Hoy en las pruebas: martes 20 de octubre de 2026, 09:20 (Ejercicio en curso). */
export const TODAY = '2026-10-20';
export const NOW = new Date(2026, 9, 20, 9, 20);

export function setNow(day: string, hour = 9, minute = 20) {
  const [y, m, d] = day.split('-').map(Number);
  vi.setSystemTime(new Date(y, m - 1, d, hour, minute));
}

/**
 * Construye 30 días de historial usando el servicio real (como lo haría una persona día a día).
 * Devuelve el almacenamiento listo para abrir en la app.
 */
export async function seed(): Promise<MemoryStorage> {
  vi.useFakeTimers({ toFake: ['Date'] });
  const storage = new MemoryStorage();
  const db = new Db(storage);
  const local = new Local(db);
  const start = addDays(TODAY, -29);
  setNow(start, 7, 0);

  await local.createActivity({ kind: 'HABIT', title: 'Meditar', start: '08:30', durationMin: 15, flexible: false, challengeDays: 60 });
  await local.createActivity({
    kind: 'HABIT',
    title: 'Ejercicio',
    start: '09:00',
    durationMin: 60,
    daysMask: 0b1101111,
    flexible: false,
    challengeDays: 45,
    items: [
      { name: 'Calentamiento', children: [
        { name: 'Trote', variables: [{ name: 'minutos', unit: 'min', target: 10 }] },
        { name: 'Movilidad', variables: [{ name: 'minutos', unit: 'min', target: 5 }] },
      ] },
      { name: 'Fuerza', children: [
        { name: 'Sentadilla', variables: [
          { name: 'series', target: 4, aggregation: 'LAST' },
          { name: 'repeticiones', target: 12, aggregation: 'LAST' },
          { name: 'peso', unit: 'kg', target: 40, step: 2.5, aggregation: 'MAX' },
        ] },
        { name: 'Zancadas', variables: [{ name: 'series', target: 3, aggregation: 'LAST' }, { name: 'repeticiones', target: 10, aggregation: 'LAST' }] },
      ] },
    ],
  });
  await local.createActivity({ kind: 'HABIT', title: 'Tomar agua', challengeDays: 30, variables: [{ name: 'vasos', target: 8 }] });
  await local.createActivity({ kind: 'HABIT', title: 'Leer', start: '13:00', durationMin: 30, challengeDays: 60, variables: [{ name: 'páginas', target: 8 }] });

  let r = 7;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;

  for (let i = 0; i < 29; i++) {
    const day = addDays(start, i);
    if (day === addDays(TODAY, -5)) {
      setNow(day, 7, 0);
      await local.createActivity({
        kind: 'HABIT', title: 'Inglés', goal: 'Llegar a B2 antes de fin de año', start: '18:00', durationMin: 30, challengeDays: 45,
        variables: [{ name: 'minutos', unit: 'min', target: 30 }, { name: 'palabras nuevas', target: 10 }],
      });
    }
    setNow(day, 21, 0);
    const view = await local.todayView();
    for (const c of view.items) {
      if (rnd() < 0.12) continue; // algunos días quedan sin hacer
      if (c.title === 'Meditar') await local.saveCheckin(c.id, [], true);
      if (c.counter) {
        const n = c.title === 'Tomar agua' ? Math.round(5 + rnd() * 4) : Math.round(4 + rnd() * 8);
        if (c.title === 'Tomar agua') for (let k = 0; k < n; k++) await local.increment(c.id, c.counter.variableId, 1);
        else await local.saveCheckin(c.id, [{ variableId: c.counter.variableId, value: n }]);
      }
      if (c.mode === 'ROUTINE') {
        const d = await local.occurrence(c.id);
        const vars = d.items.flatMap((it) => it.variables.map((v) => ({ item: it.name, ...v })));
        const values = vars.map((v) => {
          let value = v.target;
          if (v.item === 'Sentadilla' && v.name === 'peso') value = i === 28 ? 37.5 : Math.round((30 + i * 0.3 + (rnd() - 0.5) * 3) / 2.5) * 2.5;
          if (v.item === 'Sentadilla' && v.name === 'repeticiones') value = i === 28 ? 10 : Math.round(8 + i * 0.12);
          if (v.item === 'Movilidad') value = rnd() < 0.8 ? 5 : 3;
          if (c.title === 'Inglés') value = v.name === 'minutos' ? Math.round(15 + rnd() * 20) : Math.round(5 + rnd() * 8);
          return { variableId: v.id, value };
        });
        await local.saveCheckin(c.id, values);
      }
    }
  }

  // Hoy, antes de las 09:20: tarea fija que choca con Inglés, meditar hecho, 5 vasos y 3 páginas.
  setNow(TODAY, 8, 40);
  await local.createActivity({ kind: 'TASK', title: 'Llamar al banco', taskDate: TODAY, start: '18:15', durationMin: 15, priority: 2, flexible: false });
  const today = await local.todayView();
  const find = (t: string) => today.items.find((c) => c.title === t)!;
  await local.saveCheckin(find('Meditar').id, [], true);
  for (let k = 0; k < 5; k++) await local.increment(find('Tomar agua').id, find('Tomar agua').counter!.variableId, 1);
  await local.saveCheckin(find('Leer').id, [{ variableId: find('Leer').counter!.variableId, value: 3 }]);
  // Si alguna de estas tres no salió en el sorteo de ayer, se deja igual: es historial.

  setNow(TODAY, 9, 20);
  return storage;
}
