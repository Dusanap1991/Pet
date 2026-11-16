/** Tareas del día: las pendientes pasan al día siguiente, las hechas se borran al cambiar de día. */
import { dayKey, readJson, writeJson } from './store';

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  doneAt?: number;
}

export const MAX_TASK_TEXT = 120;
const MAX_TASKS = 40;

function isTask(raw: unknown): raw is Task {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.text === 'string' && typeof r.done === 'boolean' && typeof r.createdAt === 'number';
}

export class TaskStore {
  private items: Task[] = [];
  private seq = 0;

  constructor(private readonly file?: string) {
    const raw = readJson(file);
    if (Array.isArray(raw)) this.items = raw.filter(isTask).slice(0, MAX_TASKS);
  }

  /** Pendientes primero (en el orden en que se agregaron), después las hechas. */
  get list(): readonly Task[] {
    return [...this.items.filter((t) => !t.done), ...this.items.filter((t) => t.done)];
  }

  get pending(): Task[] {
    return this.items.filter((t) => !t.done);
  }

  add(text: string, now: number): Task | null {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TASK_TEXT);
    if (!clean || this.items.length >= MAX_TASKS) return null;
    const task: Task = { id: `${now.toString(36)}-${this.seq++}`, text: clean, done: false, createdAt: now };
    this.items.push(task);
    this.save();
    return task;
  }

  /** Marca o desmarca; devuelve el nuevo estado (o null si no existe). */
  toggle(id: string, now: number): boolean | null {
    const task = this.items.find((t) => t.id === id);
    if (!task) return null;
    task.done = !task.done;
    if (task.done) task.doneAt = now;
    else delete task.doneAt;
    this.save();
    return task.done;
  }

  remove(id: string): void {
    this.items = this.items.filter((t) => t.id !== id);
    this.save();
  }

  /** Al empezar un día nuevo se van las tareas hechas en días anteriores. */
  rollover(now: number): void {
    const today = dayKey(now);
    const before = this.items.length;
    this.items = this.items.filter((t) => !t.done || (t.doneAt !== undefined && dayKey(t.doneAt) === today));
    if (this.items.length !== before) this.save();
  }

  private save(): void {
    writeJson(this.file, this.items);
  }
}

export type TaskNudge = 'morning' | 'reminder';

/**
 * Cuándo recordarte las tareas: la primera vez que te ve en el día y después
 * cada cierto tiempo, mientras queden pendientes.
 */
export class TaskNudger {
  private lastDay = '';
  private nextAt = 0;

  constructor(private readonly everyMin = 120) {}

  tick(t: { now: number; pending: number; enabled: boolean; away: boolean; quiet: boolean }): TaskNudge | null {
    if (!t.enabled || t.away || t.quiet) return null;
    const today = dayKey(t.now);
    if (today !== this.lastDay) {
      this.lastDay = today;
      this.nextAt = t.now + this.everyMin * 60_000;
      return t.pending > 0 ? 'morning' : null;
    }
    if (t.pending === 0 || t.now < this.nextAt) return null;
    this.nextAt = t.now + this.everyMin * 60_000;
    return 'reminder';
  }

  /** Recién agregaste o marcaste algo: no hace falta recordártelo pronto. */
  postpone(now: number): void {
    this.nextAt = Math.max(this.nextAt, now + this.everyMin * 60_000);
  }
}
