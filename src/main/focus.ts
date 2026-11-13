/** Temporizador de una sesión de foco. Sin dependencias, para poder probarlo. */
export class FocusSession {
  private endsAt: number | null = null;
  private mins = 0;

  get active(): boolean {
    return this.endsAt !== null;
  }

  /** Duración de la sesión actual (o de la última). */
  get minutes(): number {
    return this.mins;
  }

  start(now: number, minutes: number): void {
    this.mins = minutes;
    this.endsAt = now + minutes * 60_000;
  }

  /** Devuelve true si había una sesión en curso. */
  cancel(): boolean {
    const was = this.active;
    this.endsAt = null;
    return was;
  }

  /** Devuelve true una sola vez, cuando se cumple el tiempo. */
  tick(now: number): boolean {
    if (this.endsAt !== null && now >= this.endsAt) {
      this.endsAt = null;
      return true;
    }
    return false;
  }

  remainingMin(now: number): number {
    return this.endsAt === null ? 0 : Math.max(0, Math.ceil((this.endsAt - now) / 60_000));
  }
}
