/** Resumen del día: cuánto trabajaste, pausas, foco, agua. Guarda los últimos 60 días. */
import { dayKey, previousDay, readJson, writeJson } from './store';

export interface DayStats {
  /** Segundos frente al equipo (con teclado o mouse en uso). */
  activeSec: number;
  /** Pausas de 5 minutos o más. */
  breaks: number;
  focusSessions: number;
  focusMin: number;
  /** Vasos de agua confirmados (clic en el perro tras el aviso). */
  water: number;
  tasksDone: number;
  pets: number;
  treats: number;
}

export type StatKey = Exclude<keyof DayStats, 'activeSec'>;

/** Un día cuenta para la racha si estuviste al menos este tiempo frente al equipo. */
export const STREAK_MIN_SEC = 15 * 60;
const KEEP_DAYS = 60;

export const EMPTY_DAY: DayStats = {
  activeSec: 0, breaks: 0, focusSessions: 0, focusMin: 0, water: 0, tasksDone: 0, pets: 0, treats: 0,
};

function sanitizeDay(raw: unknown): DayStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out = { ...EMPTY_DAY };
  for (const key of Object.keys(EMPTY_DAY) as (keyof DayStats)[]) {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

export class StatsStore {
  private days: Record<string, DayStats> = {};
  private dirty = false;

  constructor(private readonly file?: string) {
    const raw = readJson(file);
    if (typeof raw === 'object' && raw !== null) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(key) ? sanitizeDay(value) : null;
        if (day) this.days[key] = day;
      }
    }
  }

  private day(now: number): DayStats {
    const key = dayKey(now);
    if (!this.days[key]) {
      this.days[key] = { ...EMPTY_DAY };
      // Borra lo más viejo.
      const keys = Object.keys(this.days).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete this.days[old];
    }
    return this.days[key];
  }

  today(now: number): DayStats {
    return { ...this.day(now) };
  }

  add(now: number, key: StatKey, amount = 1): void {
    this.day(now)[key] += amount;
    this.dirty = true;
  }

  addActive(now: number, sec: number): void {
    this.day(now).activeSec += sec;
    this.dirty = true;
  }

  /** Los últimos `n` días, del más antiguo a hoy (los días sin datos van en cero). */
  history(now: number, n = 7): { day: string; stats: DayStats }[] {
    const out: { day: string; stats: DayStats }[] = [];
    let key = dayKey(now);
    for (let i = 0; i < n; i++) {
      out.unshift({ day: key, stats: { ...(this.days[key] ?? EMPTY_DAY) } });
      key = previousDay(key);
    }
    return out;
  }

  /** Días seguidos usando el equipo. Hoy cuenta si ya llegó al mínimo; si no, la racha sigue viva desde ayer. */
  streak(now: number): number {
    let key = dayKey(now);
    if ((this.days[key]?.activeSec ?? 0) < STREAK_MIN_SEC) key = previousDay(key);
    let n = 0;
    while ((this.days[key]?.activeSec ?? 0) >= STREAK_MIN_SEC) {
      n++;
      key = previousDay(key);
    }
    return n;
  }

  /** Guarda si hubo cambios. */
  save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    writeJson(this.file, this.days);
  }
}
