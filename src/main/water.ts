/**
 * Aviso para tomar agua: empieza a contar cuando arranca la app y avisa cada
 * cierto tiempo. Sin dependencias, para poder probarlo.
 */
export interface WaterTick {
  now: number;
  enabled: boolean;
  everyMin: number;
  /** No hay nadie frente al equipo: el aviso espera a que vuelva. */
  away: boolean;
  /** Momento inoportuno (sesión de foco, otro aviso recién mostrado): espera. */
  quiet: boolean;
}

export class WaterReminder {
  private nextAt: number;
  private everyMin: number;

  constructor(now: number, everyMin: number) {
    this.everyMin = everyMin;
    this.nextAt = now + everyMin * 60_000;
  }

  /** Devuelve true cuando toca avisar. */
  tick(t: WaterTick): boolean {
    if (t.everyMin !== this.everyMin) {
      // Cambió el intervalo: la cuenta empieza de nuevo.
      this.everyMin = t.everyMin;
      this.nextAt = t.now + t.everyMin * 60_000;
    }
    if (!t.enabled) {
      // Apagado no acumula: al encenderlo, el primer aviso llega un intervalo después.
      this.nextAt = t.now + t.everyMin * 60_000;
      return false;
    }
    if (t.now < this.nextAt || t.away || t.quiet) return false;
    this.nextAt = t.now + t.everyMin * 60_000;
    return true;
  }

  /** Asegura que el próximo aviso no llegue antes de `ms` (para no pisar otro mensaje). */
  postpone(now: number, ms: number): void {
    this.nextAt = Math.max(this.nextAt, now + ms);
  }

  minutesLeft(now: number): number {
    return Math.max(0, Math.ceil((this.nextAt - now) / 60_000));
  }
}
