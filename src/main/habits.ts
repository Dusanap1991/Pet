/** Hábitos diarios propios (ejercicio, leer, meditar…): se marcan cada día y llevan su racha. */
import { dayKey, previousDay, readJson, writeJson } from './store';

export interface Habit {
  id: string;
  name: string;
  /** Días cumplidos ("AAAA-MM-DD"), los más recientes. */
  done: string[];
}

export const MAX_HABITS = 12;
const KEEP_DAYS = 120;

function isHabit(raw: unknown): raw is Habit {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.done) && r.done.every((d) => typeof d === 'string');
}

export class HabitStore {
  private items: Habit[] = [];
  private seq = 0;

  constructor(private readonly file?: string) {
    const raw = readJson(file);
    if (Array.isArray(raw)) this.items = raw.filter(isHabit).slice(0, MAX_HABITS);
  }

  get list(): readonly Habit[] {
    return this.items;
  }

  add(name: string, now: number): Habit | null {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean || this.items.length >= MAX_HABITS) return null;
    const habit: Habit = { id: `${now.toString(36)}-${this.seq++}`, name: clean, done: [] };
    this.items.push(habit);
    this.save();
    return habit;
  }

  remove(id: string): void {
    this.items = this.items.filter((h) => h.id !== id);
    this.save();
  }

  /** Marca o desmarca hoy; devuelve si quedó hecho. */
  toggle(id: string, now: number): boolean | null {
    const h = this.items.find((x) => x.id === id);
    if (!h) return null;
    const today = dayKey(now);
    const done = h.done.includes(today);
    h.done = done ? h.done.filter((d) => d !== today) : [...h.done, today].sort().slice(-KEEP_DAYS);
    this.save();
    return !done;
  }

  doneOn(h: Habit, day: string): boolean {
    return h.done.includes(day);
  }

  /** Días seguidos cumplido; si hoy todavía no, la racha sigue viva desde ayer. */
  streak(h: Habit, now: number): number {
    let key = dayKey(now);
    if (!h.done.includes(key)) key = previousDay(key);
    let n = 0;
    while (h.done.includes(key)) {
      n++;
      key = previousDay(key);
    }
    return n;
  }

  private save(): void {
    writeJson(this.file, this.items);
  }
}
