import { afterEach, describe, expect, it, vi } from 'vitest';
import { Db, MemoryStorage } from '../src/local/db';
import { Local } from '../src/local/service';
import { seed, setNow, TODAY } from './seed';
import { addDays } from '../src/engine/stats';

afterEach(() => vi.useRealTimers());

async function open(storage: MemoryStorage) {
  const db = new Db(storage);
  await db.open();
  return new Local(db);
}

describe('datos en el teléfono', () => {
  it('sobreviven a cerrar y abrir la app', async () => {
    const storage = await seed();
    const a = await open(storage);
    const before = await a.todayView();
    const b = await open(storage);
    const after = await b.todayView();
    expect(after.items.map((c) => [c.title, c.status, c.subtitle])).toEqual(before.items.map((c) => [c.title, c.status, c.subtitle]));
  });

  it('una escritura interrumpida no borra nada: se usa la otra ranura', async () => {
    const storage = await seed();
    const gens = Object.values(storage.slots).map((t) => JSON.parse(t).gen as number);
    const newest = gens[0] > gens[1] ? 'a' : 'b';
    storage.slots[newest] = storage.slots[newest].slice(0, 200); // archivo cortado a la mitad
    const local = await open(storage);
    const view = await local.todayView();
    expect(view.items.length).toBeGreaterThan(4);
  });

  it('empieza vacía en un teléfono nuevo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    setNow(TODAY);
    const local = await open(new MemoryStorage());
    const view = await local.todayView();
    expect(view.items).toEqual([]);
    expect(local.planned()).toEqual([]);
  });
});

describe('reglas del día', () => {
  it('al día siguiente lo pendiente queda como no hecho', async () => {
    const storage = await seed();
    const local = await open(storage);
    const banco = (await local.todayView()).items.find((c) => c.title === 'Llamar al banco')!;
    setNow(addDays(TODAY, 1), 8, 5);
    await local.tick();
    const d = await local.occurrence(banco.id);
    expect(d.card.status).toBe('MISSED');
  });

  it('ayer se puede corregir; un registro con más de 24 h, no', async () => {
    const storage = await seed();
    const local = await open(storage);
    const leer = (await local.todayView()).items.find((c) => c.title === 'Leer')!;
    setNow(addDays(TODAY, 1), 8, 0); // 23 h después del registro de las 08:40
    await expect(local.increment(leer.id, leer.counter!.variableId, 1)).resolves.toBeTruthy();
    setNow(addDays(TODAY, 1), 10, 0); // 25 h después
    await expect(local.increment(leer.id, leer.counter!.variableId, 1)).rejects.toThrow(/24 h/);
  });

  it('el descanso no rompe la racha', async () => {
    const storage = await seed();
    const local = await open(storage);
    const meditar = (await local.todayView()).items.find((c) => c.title === 'Meditar')!;
    await local.undo(meditar.id);
    await local.skip(meditar.id);
    const d = await local.occurrence(meditar.id);
    expect(d.card.status).toBe('SKIPPED');
    expect((await local.todayView()).total).toBe(5);
  });
});

describe('avisos agendados en el teléfono', () => {
  it('agenda recordatorio y "+15 min" solo de lo pendiente, más el resumen', async () => {
    const storage = await seed();
    const local = await open(storage);
    await local.todayView();
    const today = local.planned().filter((p) => p.at.getDate() === 20);
    const titles = today.map((p) => p.title);
    expect(titles).toContain('Es hora de Leer'); // 13:00: lleva 3 de 8 páginas, sigue avisando
    expect(titles).not.toContain('Leer empezó hace 15 min'); // ya tiene registro
    expect(titles).toContain('Es hora de Inglés');
    expect(titles).toContain('Inglés empezó hace 15 min');
    expect(titles).not.toContain('Es hora de Meditar'); // ya pasó y está hecho
    expect(titles.some((t) => t.startsWith('Hoy: '))).toBe(true); // resumen de las 23:30
    expect(today.every((p) => p.at.getTime() > Date.now())).toBe(true);
  });

  it('un registro quita el "+15 min"; completarla quita también el recordatorio', async () => {
    const storage = await seed();
    const local = await open(storage);
    const ingles = (await local.todayView()).items.find((c) => c.title === 'Inglés')!;
    const [minutos, palabras] = (await local.occurrence(ingles.id)).items[0].variables;
    const mine = () => local.planned().filter((p) => p.url === `/actividad/${ingles.id}`).map((p) => p.title);
    await local.saveCheckin(ingles.id, [{ variableId: minutos.id, value: 10 }]);
    expect(mine()).toEqual(['Es hora de Inglés']);
    await local.saveCheckin(ingles.id, [{ variableId: minutos.id, value: 30 }, { variableId: palabras.id, value: 10 }]);
    expect(mine()).toEqual([]);
  });

  it('los avisos que ya sonaron aparecen en la bandeja al abrir', async () => {
    const storage = await seed();
    const local = await open(storage);
    await local.tick();
    setNow(TODAY, 18, 40);
    const list = await local.notifications();
    const titles = list.map((n) => n.title);
    expect(titles).toContain('Es hora de Inglés');
    expect(titles).toContain('Inglés empezó hace 15 min');
    expect(titles).toContain('Es hora de Leer');
  });
});

describe('respaldo', () => {
  it('exportar e importar en otro dispositivo deja los mismos datos', async () => {
    const storage = await seed();
    const phone = await open(storage);
    const json = phone.exportJson();
    const pc = await open(new MemoryStorage());
    const r = await pc.importJson(json);
    expect(r.activities).toBe(6);
    const a = await phone.dashboard();
    const b = await pc.dashboard();
    expect(b.totalCheckins).toBe(a.totalCheckins);
    expect(b.streak).toBe(a.streak);
  });

  it('rechaza un archivo que no es un respaldo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    setNow(TODAY);
    const local = await open(new MemoryStorage());
    await expect(local.importJson('{"hola":1}')).rejects.toThrow(/no es un respaldo/);
    await expect(local.importJson('no-json')).rejects.toThrow(/no es un respaldo válido/);
  });
});
