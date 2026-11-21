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
  /** Otras repeticiones: lunes a viernes, un día de la semana o una vez al año. */
  repeat?: Repeat;
}

export type Repeat =
  | { kind: 'weekdays'; h: number; m: number }
  | { kind: 'weekly'; h: number; m: number; day: number }
  | { kind: 'yearly'; h: number; m: number; month: number; date: number };

/** Lo que manda el formulario de "Nuevo recordatorio". */
export interface ReminderRequest {
  text: string;
  mode: 'in' | 'at' | 'date';
  /** Con mode 'in'. */
  minutes?: number;
  /** Con mode 'at' o 'date', "HH:MM" en hora local. */
  time?: string;
  daily?: boolean;
  /** Con mode 'at': cómo se repite. */
  repeat?: 'none' | 'daily' | 'weekdays' | 'weekly';
  /** Con repeat 'weekly': 0 = domingo … 6 = sábado. */
  weekday?: number;
  /** Con mode 'date': "AAAA-MM-DD". */
  date?: string;
  /** Con mode 'date': repetir cada año (cumpleaños, aniversarios). */
  yearly?: boolean;
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

/** La próxima vez que toca una repetición (estrictamente después de `now`). */
export function nextRepeat(rep: Repeat, now: number): number {
  const d = new Date(now);
  if (rep.kind === 'yearly') {
    for (let y = d.getFullYear(); y <= d.getFullYear() + 1; y++) {
      // 29 de febrero en un año que no es bisiesto: se usa el 28.
      const last = new Date(y, rep.month, 0).getDate();
      const t = new Date(y, rep.month - 1, Math.min(rep.date, last), rep.h, rep.m).getTime();
      if (t > now) return t;
    }
  }
  for (let i = 0; i <= 8; i++) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, rep.h, rep.m);
    if (t.getTime() <= now) continue;
    const wd = t.getDay();
    if (rep.kind === 'weekdays' && (wd === 0 || wd === 6)) continue;
    if (rep.kind === 'weekly' && wd !== rep.day) continue;
    return t.getTime();
  }
  return now + 86_400_000;
}

/** Texto corto de la repetición, para el menú. */
export function repeatLabel(r: Reminder): string {
  if (r.daily) return 'diario';
  if (!r.repeat) return '';
  if (r.repeat.kind === 'weekdays') return 'lun a vie';
  if (r.repeat.kind === 'weekly') return ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][r.repeat.day];
  return 'cada año';
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

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
    const kind = r.daily === true ? 'daily' : r.repeat;
    if (kind === 'daily') return { text, at: nextOccurrence(h, m, now), daily: { h, m } };
    if (kind === 'weekdays') {
      const repeat: Repeat = { kind: 'weekdays', h, m };
      return { text, at: nextRepeat(repeat, now), repeat };
    }
    if (kind === 'weekly') {
      if (typeof r.weekday !== 'number' || !Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) return null;
      const repeat: Repeat = { kind: 'weekly', h, m, day: r.weekday };
      return { text, at: nextRepeat(repeat, now), repeat };
    }
    return { text, at: nextOccurrence(h, m, now) };
  }
  if (r.mode === 'date') {
    const t = typeof r.time === 'string' ? HHMM.exec(r.time) : null;
    const d = typeof r.date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date) : null;
    if (!t || !d) return null;
    const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
    const h = Number(t[1]), m = Number(t[2]);
    const at = new Date(y, mo - 1, da, h, m).getTime();
    if (new Date(at).getDate() !== da) return null;
    if (r.yearly === true) {
      const repeat: Repeat = { kind: 'yearly', h, m, month: mo, date: da };
      return { text, at: at > now ? at : nextRepeat(repeat, now), repeat };
    }
    return at > now ? { text, at } : null;
  }
  return null;
}

function isReminder(raw: unknown): raw is Reminder {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.text !== 'string' || typeof r.at !== 'number' || !Number.isFinite(r.at)) return false;
  if (r.repeat !== undefined) {
    const p = r.repeat as Record<string, unknown> | null;
    if (typeof p !== 'object' || p === null || !Number.isInteger(p.h) || !Number.isInteger(p.m)) return false;
    if (p.kind === 'weekdays') return true;
    if (p.kind === 'weekly') return Number.isInteger(p.day);
    if (p.kind === 'yearly') return Number.isInteger(p.month) && Number.isInteger(p.date);
    return false;
  }
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
      if (r.daily) return [{ ...r, at: nextOccurrence(r.daily.h, r.daily.m, now) }];
      if (r.repeat) return [{ ...r, at: nextRepeat(r.repeat, now) }];
      return [];
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
