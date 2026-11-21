/** Cuentas regresivas para fechas importantes ("Vacaciones: faltan 12 días"). */
import { dayKey, readJson, writeJson } from './store';

export interface Countdown {
  id: string;
  name: string;
  /** "AAAA-MM-DD". */
  date: string;
}

const MAX = 12;

/** Días que faltan (0 = hoy, negativo = ya pasó). */
export function daysUntil(date: string, now: number): number {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const t = new Date(now);
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

export class CountdownStore {
  private items: Countdown[] = [];
  private seq = 0;

  constructor(private readonly file?: string) {
    const raw = readJson(file);
    if (Array.isArray(raw)) {
      this.items = raw.filter((r): r is Countdown =>
        typeof r === 'object' && r !== null && typeof r.id === 'string' && typeof r.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    }
  }

  /** Próximas primero; las que ya pasaron hace más de un día se borran solas. */
  list(now: number): Countdown[] {
    const before = this.items.length;
    this.items = this.items.filter((c) => daysUntil(c.date, now) >= -1);
    if (this.items.length !== before) this.save();
    return [...this.items].sort((a, b) => a.date.localeCompare(b.date));
  }

  add(name: string, date: string, now: number): Countdown | null {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean || !/^\d{4}-\d{2}-\d{2}$/.test(date) || daysUntil(date, now) < 0 || this.items.length >= MAX) return null;
    const c: Countdown = { id: `${now.toString(36)}-${this.seq++}`, name: clean, date };
    this.items.push(c);
    this.save();
    return c;
  }

  remove(id: string): void {
    this.items = this.items.filter((c) => c.id !== id);
    this.save();
  }

  /** Avisos del día: "Mañana: …" y "¡Hoy es …!". */
  todayNotices(now: number): string[] {
    const out: string[] = [];
    for (const c of this.list(now)) {
      const d = daysUntil(c.date, now);
      if (d === 0) out.push(`🎉 ¡Hoy es ${c.name}!`);
      else if (d === 1) out.push(`⏳ Mañana: ${c.name}`);
    }
    return out;
  }

  private save(): void {
    writeJson(this.file, this.items);
  }
}

/** Días juntos y si hoy es un aniversario para celebrar. */
export function together(firstDay: string, now: number): { days: number; milestone: string | null } {
  const days = -daysUntil(firstDay, now);
  const milestones: Record<number, string> = {
    7: '¡Hoy cumplimos una semana juntos! 🎂',
    30: '¡Hoy cumplimos un mes juntos! 🎂',
    100: '¡100 días juntos! 🎉',
    182: '¡Medio año juntos! 🎂',
    365: '¡Un año juntos! 🎂🎉',
  };
  let milestone = milestones[days] ?? null;
  if (!milestone && days > 365 && days % 365 === 0) milestone = `¡${days / 365} años juntos! 🎂`;
  return { days, milestone };
}

export { dayKey };
