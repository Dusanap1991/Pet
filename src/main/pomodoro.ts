/** Pomodoro: 25 min de foco y 5 de descanso; cada 4 focos, un descanso largo de 15. */

export type PomodoroPhase = 'focus' | 'break' | 'long-break';

export interface PomodoroStep {
  phase: PomodoroPhase;
  /** Número de foco dentro de la vuelta (1 a 4). */
  round: number;
  minutes: number;
}

export const POMODORO = { focus: 25, break: 5, longBreak: 15, rounds: 4 } as const;

export class Pomodoro {
  private step: PomodoroStep | null = null;
  private endsAt = 0;

  get active(): boolean {
    return this.step !== null;
  }

  get current(): PomodoroStep | null {
    return this.step;
  }

  get inFocus(): boolean {
    return this.step?.phase === 'focus';
  }

  remainingMs(now: number): number {
    return this.step ? Math.max(0, this.endsAt - now) : 0;
  }

  remainingMin(now: number): number {
    return this.step ? Math.max(0, Math.ceil((this.endsAt - now) / 60_000)) : 0;
  }

  start(now: number): PomodoroStep {
    return this.go(now, { phase: 'focus', round: 1, minutes: POMODORO.focus });
  }

  stop(): boolean {
    const was = this.active;
    this.step = null;
    return was;
  }

  /** Devuelve el paso que empieza cuando se cumple el anterior (una sola vez). */
  tick(now: number): { ended: PomodoroStep; next: PomodoroStep } | null {
    if (!this.step || now < this.endsAt) return null;
    const ended = this.step;
    let next: PomodoroStep;
    if (ended.phase === 'focus') {
      next = ended.round >= POMODORO.rounds
        ? { phase: 'long-break', round: ended.round, minutes: POMODORO.longBreak }
        : { phase: 'break', round: ended.round, minutes: POMODORO.break };
    } else {
      next = { phase: 'focus', round: ended.phase === 'long-break' ? 1 : ended.round + 1, minutes: POMODORO.focus };
    }
    // Encadena desde la hora en que debía terminar, no desde ahora: no se va corriendo.
    this.go(Math.max(this.endsAt, now - 60_000), next);
    return { ended, next };
  }

  private go(from: number, step: PomodoroStep): PomodoroStep {
    this.step = step;
    this.endsAt = from + step.minutes * 60_000;
    return step;
  }
}
