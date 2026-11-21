/** Ánimo y hambre del perro: dependen de cómo lo tratas. Nunca le pasa nada malo; solo se pone triste o pide comida. */
import { readJson, writeJson } from './store';

export interface MoodState {
  /** 0 = triste, 100 = feliz. */
  joy: number;
  /** 0 = hambriento, 100 = lleno. */
  food: number;
}

export type MoodAction = 'pet' | 'treat' | 'play' | 'water' | 'task' | 'drop' | 'cookie' | 'bone' | 'sausage' | 'meal';

const GAIN: Record<MoodAction, Partial<MoodState>> = {
  pet: { joy: 6 },
  treat: { food: 30, joy: 4 },
  play: { joy: 10 },
  water: { joy: 3 },
  task: { joy: 4 },
  drop: { joy: -2 },
  cookie: { food: 15, joy: 3 },
  bone: { food: 25, joy: 5 },
  sausage: { food: 35, joy: 10 },
  meal: { food: 100, joy: 6 },
};

/** Puntos que pierde por minuto (despierto / mientras no estás y duerme). */
const DECAY = { food: 1 / 6, joy: 1 / 5 };
const AWAY_FACTOR = 0.25;

const clamp = (v: number): number => Math.max(0, Math.min(100, v));

export function joyLabel(joy: number): string {
  if (joy >= 70) return 'Feliz';
  if (joy >= 40) return 'Tranquilo';
  if (joy >= 15) return 'Aburrido';
  return 'Triste';
}

export function foodLabel(food: number): string {
  if (food >= 60) return 'Satisfecho';
  if (food >= 25) return 'Con hambrecita';
  return 'Hambriento';
}

export class Mood {
  state: MoodState = { joy: 70, food: 80 };
  private dirty = false;

  constructor(private readonly file?: string) {
    const raw = readJson(file) as Partial<MoodState> | undefined;
    if (raw && typeof raw.joy === 'number' && typeof raw.food === 'number') {
      this.state = { joy: clamp(raw.joy), food: clamp(raw.food) };
    }
  }

  /** Pasa el tiempo: `dtMs` desde el último llamado. */
  decay(dtMs: number, away: boolean): void {
    const min = (dtMs / 60_000) * (away ? AWAY_FACTOR : 1);
    this.state = { joy: clamp(this.state.joy - DECAY.joy * min), food: clamp(this.state.food - DECAY.food * min) };
    this.dirty = true;
  }

  apply(action: MoodAction): void {
    const g = GAIN[action];
    this.state = { joy: clamp(this.state.joy + (g.joy ?? 0)), food: clamp(this.state.food + (g.food ?? 0)) };
    this.dirty = true;
  }

  get hungry(): boolean {
    return this.state.food < 25;
  }

  save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    writeJson(this.file, { joy: Math.round(this.state.joy * 10) / 10, food: Math.round(this.state.food * 10) / 10 });
  }
}
