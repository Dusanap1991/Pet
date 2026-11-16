/** Cosas que pasan una vez al día a cierta hora: fin de jornada, resumen semanal, aviso de noche. */
import { dayKey } from './store';

/** "18:30" → { h: 18, m: 30 }; null si no es una hora válida. */
export function parseHHMM(raw: string): { h: number; m: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  return match ? { h: Number(match[1]), m: Number(match[2]) } : null;
}

export class DailyTrigger {
  private lastDay = '';

  /**
   * @param windowMin cuánto después de la hora todavía vale avisar (por ejemplo,
   *                  si estabas en una reunión o fuera del equipo justo a esa hora).
   * @param days      días de la semana en que corre (0 = domingo).
   */
  constructor(private readonly windowMin = 120, private readonly days: readonly number[] = [0, 1, 2, 3, 4, 5, 6]) {}

  tick(t: { now: number; h: number; m: number; enabled: boolean; ready: boolean }): boolean {
    if (!t.enabled || !t.ready) return false;
    const d = new Date(t.now);
    if (!this.days.includes(d.getDay())) return false;
    const today = dayKey(t.now);
    if (this.lastDay === today) return false;
    const at = new Date(t.now);
    at.setHours(t.h, t.m, 0, 0);
    const late = t.now - at.getTime();
    if (late < 0 || late > this.windowMin * 60_000) return false;
    this.lastDay = today;
    return true;
  }
}

export const WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const FRIDAY = [5] as const;
