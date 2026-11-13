/**
 * Recordatorios y temporizadores. Sin dependencias de Electron, para poder probarlo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Reminder {
  id: string;
  text: string;
  /** Cuándo toca, en milisegundos. */
  at: number;
  /** Si se repite todos los días, a qué hora local. */
  daily?: { h: number; m: number };
}

/** Lo que manda el formulario de "Nuevo recordatorio". */
export interface ReminderRequest {
  text: string;
  mode: 'in' | 'at';
  /** Con mode 'in'. */
  minutes?: number;
  /** Con mode 'at', "HH:MM" en hora local. */
  time?: string;
  daily?: boolean;
}

export const MAX_TEXT = 120;
const MAX_REMINDERS = 50;

/** La próxima vez que el reloj local marque h:m (hoy si todavía no pasó, si no mañana). */
export function nextOccurrence(h: number, m: number, now: number): number {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Valida lo que llega del formulario; devuelve null si no sirve. */
export function parseRequest(raw: unknown, now: number): Omit<Reminder, 'id'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
  if (!text) return null;
  if (r.mode === 'in') {
    if (typeof r.minutes !== 'number' || !Number.isFinite(r.minutes) || r.minutes < 1 || r.minutes > 24 * 60) return null;
    return { text, at: now + Math.round(r.minutes) * 60_000 };
  }
  if (r.mode === 'at') {
    const match = typeof r.time === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(r.time) : null;
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    return { text, at: nextOccurrence(h, m, now), ...(r.daily === true ? { daily: { h, m } } : {}) };
  }
  return null;
}

function isReminder(raw: unknown): raw is Reminder {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.text !== 'string' || typeof r.at !== 'number' || !Number.isFinite(r.at)) return false;
  if (r.daily === undefined) return true;
  const d = r.daily as Record<string, unknown> | null;
  return typeof d === 'object' && d !== null && Number.isInteger(d.h) && Number.isInteger(d.m);
}

export class ReminderStore {
  private items: Reminder[] = [];
  private seq = 0;

  /** `file` es opcional: sin archivo, vive solo en memoria. */
  constructor(private readonly file?: string) {
    if (!file) return;
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) this.items = raw.filter(isReminder).slice(0, MAX_REMINDERS);
    } catch {
      // Sin archivo o ilegible: se parte sin recordatorios.
    }
  }

  /** Pendientes, del más próximo al más lejano. */
  get list(): readonly Reminder[] {
    return [...this.items].sort((a, b) => a.at - b.at);
  }

  add(reminder: Omit<Reminder, 'id'>): Reminder | null {
    if (this.items.length >= MAX_REMINDERS) return null;
    const created: Reminder = { ...reminder, id: `${Date.now().toString(36)}-${this.seq++}` };
    this.items.push(created);
    this.save();
    return created;
  }

  remove(id: string): void {
    this.items = this.items.filter((r) => r.id !== id);
    this.save();
  }

  /** Los que ya tocan. Los de una vez se borran; los diarios pasan al día siguiente. */
  takeDue(now: number): Reminder[] {
    const due = this.items.filter((r) => r.at <= now).sort((a, b) => a.at - b.at);
    if (due.length === 0) return due;
    this.items = this.items.flatMap((r) => {
      if (r.at > now) return [r];
      return r.daily ? [{ ...r, at: nextOccurrence(r.daily.h, r.daily.m, now) }] : [];
    });
    this.save();
    return due;
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2));
    } catch (err) {
      console.error('No se pudieron guardar los recordatorios:', err);
    }
  }
}
