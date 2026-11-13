/**
 * Una pose describe al perro con puntos clave en coordenadas locales:
 * mira hacia +x, el suelo está en y = 0 y hacia arriba es y negativo.
 * Todas las propiedades son números, así que mezclar dos poses es interpolar.
 */
export interface Pose {
  rumpX: number;
  rumpY: number;
  chestX: number;
  chestY: number;
  headX: number;
  headY: number;
  /** Ángulo del hocico: 0 = horizontal, positivo = hacia abajo. */
  snoutAng: number;
  /** Ángulo de la oreja: 0 = cuelga recta, positivo = hacia atrás. */
  earAng: number;
  tailAng: number;
  tailCurl: number;
  /** Patas delanteras (cercana y lejana) y traseras (cercana y lejana). */
  ffx: number;
  ffy: number;
  ffx2: number;
  ffy2: number;
  rfx: number;
  rfy: number;
  rfx2: number;
  rfy2: number;
  /** 0..1: cuánto se nota el muslo doblado (sentado o echado). */
  haunch: number;
  eyeOpen: number;
  eyeHappy: number;
  mouthOpen: number;
  tongue: number;
  /** 0..1: pliegue de piel en la nuca cuando lo levantan del pellejo. */
  scruff: number;
}

export const POSE_KEYS = [
  'rumpX', 'rumpY', 'chestX', 'chestY', 'headX', 'headY', 'snoutAng', 'earAng',
  'tailAng', 'tailCurl', 'ffx', 'ffy', 'ffx2', 'ffy2', 'rfx', 'rfy', 'rfx2', 'rfy2',
  'haunch', 'eyeOpen', 'eyeHappy', 'mouthOpen', 'tongue', 'scruff',
] as const satisfies readonly (keyof Pose)[];

export const STAND: Pose = {
  rumpX: -42, rumpY: -33, chestX: 34, chestY: -35,
  headX: 57, headY: -66,
  snoutAng: 0.1, earAng: 0.15,
  tailAng: -2.55, tailCurl: 0.32,
  ffx: 31, ffy: -4.5, ffx2: 22, ffy2: -4.5,
  rfx: -44, rfy: -4.5, rfx2: -53, rfy2: -4.5,
  haunch: 0, eyeOpen: 1, eyeHappy: 0, mouthOpen: 0, tongue: 0, scruff: 0,
};

export const SIT: Pose = {
  ...STAND,
  rumpX: -34, rumpY: -17, chestX: 34, chestY: -38,
  headX: 56, headY: -70,
  tailAng: -3.05, tailCurl: 0.12,
  rfx: -20, rfx2: -27,
  haunch: 1,
};

export const LIE: Pose = {
  ...STAND,
  rumpX: -40, rumpY: -16, chestX: 32, chestY: -19,
  headX: 53, headY: -49,
  tailAng: -3.05, tailCurl: 0.1,
  ffx: 57, ffy: -4.5, ffx2: 62, ffy2: -5.5,
  rfx: -24, rfx2: -31,
  haunch: 1,
};

export const SLEEP: Pose = {
  ...LIE,
  headX: 57, headY: -19.5,
  snoutAng: 0.3, earAng: 1.1,
  eyeOpen: 0, tailCurl: 0.05,
};

export function clonePose(p: Pose): Pose {
  return { ...p };
}

/** Acerca `cur` a `target` con suavizado exponencial (independiente del framerate). */
export function approachPose(cur: Pose, target: Pose, dt: number, rate: number, fastRate: number): void {
  const k = 1 - Math.exp(-rate * dt);
  const kFast = 1 - Math.exp(-fastRate * dt);
  for (const key of POSE_KEYS) {
    const fast = key === 'eyeOpen' || key === 'eyeHappy' || key === 'mouthOpen';
    cur[key] += (target[key] - cur[key]) * (fast ? kFast : k);
  }
}
