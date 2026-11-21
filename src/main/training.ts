/** Entrenamiento: con cada orden cumplida obedece más seguido (y más rápido si lo premias). */
export const TRAINING_FULL = 30;

export function skillOf(points: number): number {
  return Math.min(1, Math.max(0, points) / TRAINING_FULL);
}

/** Probabilidad de obedecer: 55 % al empezar, 97 % bien entrenado. */
export function obeyChance(points: number): number {
  return 0.55 + 0.42 * skillOf(points);
}

export function trainingLevel(points: number): { level: number; label: string } {
  const s = skillOf(points);
  if (s >= 1) return { level: 4, label: 'Experto' };
  if (s >= 0.6) return { level: 3, label: 'Obediente' };
  if (s >= 0.25) return { level: 2, label: 'Aprendiendo' };
  return { level: 1, label: 'Cachorro' };
}
