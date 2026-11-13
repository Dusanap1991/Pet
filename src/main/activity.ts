/**
 * Convierte "segundos desde el último input" en eventos para el perro.
 * No depende de Electron: recibe la hora y el tiempo inactivo, así se puede probar.
 *
 * Solo usa el tiempo de inactividad del sistema; nunca qué teclas se presionan.
 */

export interface ActivityOptions {
  /** Sin input por este tiempo: el perro asume que te fuiste y se duerme. */
  awayAfterSec: number;
  /** Sin input por este tiempo: cuenta como descanso y reinicia el tramo de trabajo. */
  breakResetSec: number;
  /** Si sigues trabajando después del aviso, vuelve a avisar cada tanto. */
  renotifyMin: number;
  /** Un salto entre mediciones mayor a esto significa que el equipo estuvo suspendido. */
  gapSec: number;
}

export const DEFAULT_ACTIVITY: ActivityOptions = {
  awayAfterSec: 120,
  breakResetSec: 300,
  renotifyMin: 10,
  gapSec: 60,
};

export type ActivityEvent =
  | { type: 'away' }
  | { type: 'back'; awaySec: number }
  | { type: 'break-due'; minutes: number };

export interface TickInput {
  /** Hora actual en milisegundos. */
  now: number;
  /** Segundos desde el último input de teclado o mouse. */
  idleSec: number;
  breaksEnabled: boolean;
  breakEveryMin: number;
}

export class ActivityTracker {
  private away = false;
  /** Cuándo empezó la ausencia (para decir cuánto duró). */
  private awaySince = 0;
  /** Solo un input posterior a esta marca cuenta como "volvió". */
  private awayMark = 0;
  private stretchStart: number | null = null;
  private lastNotified: number | null = null;
  private lastTick: number | null = null;

  constructor(private readonly opt: ActivityOptions = DEFAULT_ACTIVITY) {}

  get isAway(): boolean {
    return this.away;
  }

  tick(input: TickInput): ActivityEvent[] {
    const out: ActivityEvent[] = [];
    const { now, idleSec } = input;

    if (this.lastTick !== null && now - this.lastTick > this.opt.gapSec * 1000) {
      const gap = now - this.lastTick;
      if (!this.away) {
        this.away = true;
        this.awaySince = this.lastTick;
        this.awayMark = now;
        out.push({ type: 'away' });
      }
      if (gap >= this.opt.breakResetSec * 1000) this.endStretch();
    }
    this.lastTick = now;

    const lastInput = now - idleSec * 1000;

    if (!this.away && idleSec >= this.opt.awayAfterSec) {
      this.away = true;
      this.awaySince = lastInput;
      this.awayMark = lastInput;
      out.push({ type: 'away' });
    } else if (this.away && idleSec < this.opt.awayAfterSec && lastInput > this.awayMark + 1500) {
      this.away = false;
      out.push({ type: 'back', awaySec: Math.round((now - this.awaySince) / 1000) });
    }

    if (idleSec >= this.opt.breakResetSec) {
      this.endStretch();
    } else if (this.stretchStart === null && !this.away && idleSec < 30) {
      this.stretchStart = now;
    }

    if (input.breaksEnabled && this.stretchStart !== null && !this.away) {
      const worked = now - this.stretchStart;
      const due = worked >= input.breakEveryMin * 60_000;
      const quiet = this.lastNotified === null || now - this.lastNotified >= this.opt.renotifyMin * 60_000;
      if (due && quiet) {
        out.push({ type: 'break-due', minutes: Math.round(worked / 60_000) });
        this.lastNotified = now;
      }
    }

    return out;
  }

  /** Pantalla bloqueada o equipo por suspenderse: ausente desde ya. */
  forceAway(now: number): ActivityEvent[] {
    if (this.away) return [];
    this.away = true;
    this.awaySince = now;
    this.awayMark = now;
    return [{ type: 'away' }];
  }

  /** Pospone el próximo aviso de descanso (por ejemplo, al terminar una sesión de foco). */
  snooze(now: number): void {
    this.lastNotified = now;
  }

  private endStretch(): void {
    this.stretchStart = null;
    this.lastNotified = null;
  }
}
