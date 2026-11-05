import { Capacitor } from '@capacitor/core';
import { BrowserStorage, Db, FileStorage, type Storage } from './local/db';
import { Local, ServiceError } from './local/service';
import type { ActivityInput } from './types';

/** Todo vive en el teléfono: no hay servidor ni conexión. */
let local: Local | null = null;

export class ApiError extends Error {}

/** Abre la base local. En Android usa archivos internos; en el navegador, localStorage. */
export async function initLocal(storage?: Storage, clock?: { now(): Date }): Promise<Local> {
  const db = new Db(storage ?? (Capacitor.isNativePlatform() ? new FileStorage() : new BrowserStorage()));
  await db.open();
  local = new Local(db, clock);
  await local.tick();
  return local;
}

export function getLocal(): Local {
  if (!local) throw new Error('La base local no está abierta');
  return local;
}

/** Traduce los errores de validación a ApiError para que las pantallas muestren el mensaje. */
async function call<T>(fn: (l: Local) => Promise<T>): Promise<T> {
  try {
    return await fn(getLocal());
  } catch (e) {
    if (e instanceof ServiceError) throw new ApiError(e.message);
    throw e;
  }
}

export const api = {
  today: () => call((l) => l.todayView()),
  occurrence: (id: number) => call((l) => l.occurrence(id)),
  saveCheckin: (id: number, values: { variableId: number; value: number }[], done?: boolean) =>
    call((l) => l.saveCheckin(id, values, done)),
  increment: (id: number, variableId: number, amount: number) => call((l) => l.increment(id, variableId, amount)),
  undo: (id: number) => call((l) => l.undo(id)),
  skip: (id: number) => call((l) => l.skip(id)),
  resolution: (id: number) => call((l) => l.resolution(id)),
  move: (id: number, start: string) => call((l) => l.move(id, start)),
  day: (date: string) => call((l) => l.day(date)),
  activities: () => call((l) => l.activities()),
  createActivity: (input: ActivityInput) => call((l) => l.createActivity(input)),
  setActivityStatus: (id: number, status: string) => call((l) => l.setActivityStatus(id, status)),
  checkSchedule: (input: { kind: string; daysMask?: number; taskDate?: string | null; start: string; durationMin: number }) =>
    call((l) => l.checkSchedule(input)),
  progress: (variableId: number, days: number) => call((l) => l.progress(variableId, days)),
  dashboard: () => call((l) => l.dashboard()),
  notifications: () => call((l) => l.notifications()),
  markRead: () => call((l) => l.markRead()),
  settings: () => call((l) => l.settings()),
  exportJson: () => call(async (l) => l.exportJson()),
  importJson: (text: string) => call((l) => l.importJson(text)),
};
