/** Logros: contadores de toda la vida y medallas que se desbloquean una vez. */
import { readJson, writeJson } from './store';

export type Counter = 'pets' | 'water' | 'focus' | 'tasks' | 'treats' | 'play' | 'pomodoros' | 'reminders' | 'early' | 'files' | 'stretches' | 'waterGoals' | 'habits' | 'meals';

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  /** Qué hay que hacer. */
  hint: string;
  counter: Counter | 'streak' | 'named';
  goal: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-pet', icon: '🤚', title: 'Primera caricia', hint: 'Hazle cariño', counter: 'pets', goal: 1 },
  { id: 'pets-100', icon: '💛', title: 'Mejores amigos', hint: '100 caricias', counter: 'pets', goal: 100 },
  { id: 'named', icon: '🏷️', title: 'Bautizado', hint: 'Ponle nombre', counter: 'named', goal: 1 },
  { id: 'water-1', icon: '💧', title: 'Primer vaso', hint: 'Toma agua tras un aviso', counter: 'water', goal: 1 },
  { id: 'water-50', icon: '🚰', title: 'Bien hidratado', hint: '50 vasos de agua', counter: 'water', goal: 50 },
  { id: 'water-200', icon: '🌊', title: 'Camello al revés', hint: '200 vasos de agua', counter: 'water', goal: 200 },
  { id: 'focus-1', icon: '🎯', title: 'Concentrado', hint: 'Termina una sesión de foco', counter: 'focus', goal: 1 },
  { id: 'focus-25', icon: '🧠', title: 'Modo profundo', hint: '25 sesiones de foco', counter: 'focus', goal: 25 },
  { id: 'pomodoro-4', icon: '🍅', title: 'Vuelta completa', hint: 'Una vuelta entera de Pomodoro (4 focos)', counter: 'pomodoros', goal: 1 },
  { id: 'tasks-10', icon: '✅', title: 'Cumplidor', hint: '10 tareas hechas', counter: 'tasks', goal: 10 },
  { id: 'tasks-100', icon: '🏆', title: 'Imparable', hint: '100 tareas hechas', counter: 'tasks', goal: 100 },
  { id: 'streak-3', icon: '🔥', title: 'Racha de 3', hint: '3 días seguidos', counter: 'streak', goal: 3 },
  { id: 'streak-7', icon: '📅', title: 'Una semana', hint: '7 días seguidos', counter: 'streak', goal: 7 },
  { id: 'streak-30', icon: '🌟', title: 'Un mes juntos', hint: '30 días seguidos', counter: 'streak', goal: 30 },
  { id: 'meals-14', icon: '🍽️', title: 'Bien alimentado', hint: 'Sírvele comida 14 veces', counter: 'meals', goal: 14 },
  { id: 'treats-20', icon: '🦴', title: 'Consentido', hint: '20 premios', counter: 'treats', goal: 20 },
  { id: 'play-20', icon: '🎾', title: 'Buscador', hint: 'Juega 20 veces a la pelota', counter: 'play', goal: 20 },
  { id: 'reminders-10', icon: '⏰', title: 'Memoria de elefante', hint: '10 recordatorios cumplidos', counter: 'reminders', goal: 10 },
  { id: 'early', icon: '🌅', title: 'Madrugador', hint: 'Llegar antes de las 8:00', counter: 'early', goal: 1 },
  { id: 'stretch-10', icon: '🧘', title: 'Flexible', hint: '10 rutinas de estiramiento', counter: 'stretches', goal: 10 },
  { id: 'water-goal-7', icon: '🏅', title: 'Siempre hidratado', hint: 'Cumple la meta de agua 7 días', counter: 'waterGoals', goal: 7 },
  { id: 'habits-30', icon: '🌱', title: 'Constante', hint: 'Marca 30 hábitos cumplidos', counter: 'habits', goal: 30 },
  { id: 'files-10', icon: '📦', title: 'Ordenado', hint: 'Ordena 10 archivos con el perro', counter: 'files', goal: 10 },
];

export interface AchievementView extends Achievement {
  unlocked: boolean;
  progress: number;
}

export class Achievements {
  private counts: Partial<Record<Counter, number>> = {};
  private unlocked = new Set<string>();
  private streak = 0;
  private named = false;

  constructor(private readonly file?: string) {
    const raw = readJson(file) as { counts?: Record<string, unknown>; unlocked?: unknown[] } | undefined;
    if (raw?.counts) {
      for (const [k, v] of Object.entries(raw.counts)) if (typeof v === 'number' && v >= 0) this.counts[k as Counter] = v;
    }
    if (Array.isArray(raw?.unlocked)) for (const id of raw.unlocked) if (typeof id === 'string') this.unlocked.add(id);
  }

  private value(a: Achievement): number {
    if (a.counter === 'streak') return this.streak;
    if (a.counter === 'named') return this.named ? 1 : 0;
    return this.counts[a.counter] ?? 0;
  }

  /** Suma y devuelve los logros recién desbloqueados. */
  bump(counter: Counter, n = 1): Achievement[] {
    this.counts[counter] = Math.max(0, (this.counts[counter] ?? 0) + n);
    return this.check();
  }

  /** Actualiza lo que no es un contador (racha, nombre) y devuelve lo recién desbloqueado. */
  update(t: { streak: number; named: boolean }): Achievement[] {
    this.streak = t.streak;
    this.named = t.named;
    return this.check();
  }

  private check(): Achievement[] {
    const fresh = ACHIEVEMENTS.filter((a) => !this.unlocked.has(a.id) && this.value(a) >= a.goal);
    for (const a of fresh) this.unlocked.add(a.id);
    if (fresh.length) this.save();
    return fresh;
  }

  list(): AchievementView[] {
    return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: this.unlocked.has(a.id), progress: Math.min(this.value(a), a.goal) }));
  }

  save(): void {
    writeJson(this.file, { counts: this.counts, unlocked: [...this.unlocked] });
  }
}
