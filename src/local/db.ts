/**
 * Base de datos local: un documento JSON guardado en el almacenamiento interno de la app.
 * Se escribe en dos ranuras alternas (A/B) con un número de generación: si la app se cierra a mitad
 * de una escritura, al abrir se usa la ranura válida más reciente y nunca se pierde todo.
 */

export type Kind = 'HABIT' | 'TASK';
export type Status = 'PENDING' | 'PARTIAL' | 'DONE' | 'MISSED' | 'SKIPPED';
export type Aggregation = 'SUM' | 'MAX' | 'LAST';

export interface Settings {
  dayStart: number; // minutos: 480 = 08:00
  dayEnd: number; // 1440 = 24:00
  nudgeMinutes: number;
  summaryMin: number; // 1410 = 23:30
}

export interface Activity {
  id: number;
  kind: Kind;
  title: string;
  goal: string | null;
  daysMask: number; // lunes = bit 0 … domingo = bit 6
  taskDate: string | null;
  start: number | null; // minutos; null = todo el día
  durationMin: number;
  flexible: boolean;
  parallel: boolean;
  priority: number; // 0 baja, 1 media, 2 alta
  challengeStart: string;
  challengeEnd: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  routineId: number | null;
  routineName: string | null;
  createdAt: string;
}

export interface Item {
  id: number;
  routineId: number;
  parentId: number | null;
  name: string;
  position: number;
  depth: number;
  required: boolean;
}

export interface Variable {
  id: number;
  itemId: number;
  name: string;
  unit: string | null;
  target: number;
  step: number;
  aggregation: Aggregation;
  position: number;
}

export interface Occurrence {
  id: number;
  activityId: number;
  day: string;
  startMin: number | null;
  endMin: number | null;
  status: Status;
  progress: number;
  movedFrom: number | null;
}

export interface Entry {
  variableId: number;
  value: number;
  target: number; // meta vigente ese día
  at: string;
}

export interface Checkin {
  occurrenceId: number;
  createdAt: string;
  editedAt: string | null;
  done: boolean;
  entries: Entry[];
}

export interface Notice {
  id: number;
  key: string; // evita duplicados: "R12", "N12", "S2026-10-20", "D12"…
  occurrenceId: number | null;
  type: 'REMINDER' | 'NUDGE' | 'CONFLICT' | 'SUMMARY' | 'DONE';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface Data {
  app: 'constancia';
  version: 1;
  seq: number;
  settings: Settings;
  activities: Activity[];
  items: Item[];
  variables: Variable[];
  occurrences: Occurrence[];
  checkins: Record<string, Checkin>;
  notices: Notice[];
  lastTick: string | null; // último instante en que se revisaron avisos y cierres
}

export function emptyData(): Data {
  return {
    app: 'constancia',
    version: 1,
    seq: 1,
    settings: { dayStart: 480, dayEnd: 1440, nudgeMinutes: 15, summaryMin: 1410 },
    activities: [],
    items: [],
    variables: [],
    occurrences: [],
    checkins: {},
    notices: [],
    lastTick: null,
  };
}

/** Valida la forma mínima de un documento (para abrir y para importar respaldos). */
export function isData(x: unknown): x is Data {
  const d = x as Data;
  return (
    !!d &&
    d.app === 'constancia' &&
    d.version === 1 &&
    typeof d.seq === 'number' &&
    Array.isArray(d.activities) &&
    Array.isArray(d.items) &&
    Array.isArray(d.variables) &&
    Array.isArray(d.occurrences) &&
    typeof d.checkins === 'object' &&
    Array.isArray(d.notices)
  );
}

// ---------------------------------------------------------------- almacenamiento

export interface Storage {
  read(slot: 'a' | 'b'): Promise<string | null>;
  write(slot: 'a' | 'b', text: string): Promise<void>;
}

interface Envelope {
  gen: number;
  data: Data;
}

export class Db {
  data: Data = emptyData();
  private gen = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private storage: Storage) {}

  /** Abre la ranura válida más reciente; si no hay ninguna, empieza vacía. */
  async open(): Promise<void> {
    let best: Envelope | null = null;
    for (const slot of ['a', 'b'] as const) {
      try {
        const text = await this.storage.read(slot);
        if (!text) continue;
        const env = JSON.parse(text) as Envelope;
        if (typeof env.gen === 'number' && isData(env.data) && (!best || env.gen > best.gen)) best = env;
      } catch {
        // ranura dañada o ausente: se ignora
      }
    }
    if (best) {
      this.data = best.data;
      this.gen = best.gen;
    }
  }

  /** Guarda en la ranura contraria a la última; las escrituras van en fila. */
  save(): Promise<void> {
    const text = () => {
      this.gen += 1;
      return { slot: (this.gen % 2 === 0 ? 'a' : 'b') as 'a' | 'b', body: JSON.stringify({ gen: this.gen, data: this.data }) };
    };
    this.queue = this.queue.then(async () => {
      const { slot, body } = text();
      await this.storage.write(slot, body);
    });
    return this.queue;
  }

  replace(data: Data): Promise<void> {
    this.data = data;
    return this.save();
  }

  nextId(): number {
    return this.data.seq++;
  }
}

/** Memoria (pruebas). */
export class MemoryStorage implements Storage {
  slots: Record<string, string> = {};
  async read(slot: 'a' | 'b') {
    return this.slots[slot] ?? null;
  }
  async write(slot: 'a' | 'b', text: string) {
    this.slots[slot] = text;
  }
}

/** Navegador (versión web / PC): localStorage. */
export class BrowserStorage implements Storage {
  async read(slot: 'a' | 'b') {
    try {
      return localStorage.getItem(`constancia.${slot}`);
    } catch {
      return null;
    }
  }
  async write(slot: 'a' | 'b', text: string) {
    localStorage.setItem(`constancia.${slot}`, text);
  }
}

/** Android: archivos en el almacenamiento interno privado de la app. */
export class FileStorage implements Storage {
  async read(slot: 'a' | 'b') {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    try {
      const r = await Filesystem.readFile({ path: `constancia-${slot}.json`, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof r.data === 'string' ? r.data : null;
    } catch {
      return null;
    }
  }
  async write(slot: 'a' | 'b', text: string) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({ path: `constancia-${slot}.json`, directory: Directory.Data, encoding: Encoding.UTF8, data: text });
  }
}
