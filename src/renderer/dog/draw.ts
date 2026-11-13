import type { Pose } from './pose';

type Ctx = CanvasRenderingContext2D;

export interface Palette {
  fur: string;
  furDark: string;
  furLight: string;
  outline: string;
  nose: string;
  collar: string;
  tag: string;
  tongue: string;
  mouth: string;
  eye: string;
}

/** Salchicha colorado clásico. */
export const DACHSHUND: Palette = {
  fur: '#C4733B',
  furDark: '#96521F',
  furLight: '#E0A66F',
  outline: '#3A2212',
  nose: '#2A1810',
  collar: '#2F7FE0',
  tag: '#F7C948',
  tongue: '#F27C96',
  mouth: '#5A1E22',
  eye: '#1E130C',
};

/** Valores que oscilan rápido y no pasan por el suavizado de la pose. */
export interface DrawExtras {
  /** -1..1, respiración. */
  breath: number;
  /** Radianes extra en la base de la cola. */
  wag: number;
  /** Igual que `wag` pero con retardo, para que la punta llegue después. */
  wagLag: number;
}

interface Part {
  path(ctx: Ctx): void;
  fill: string;
}

const OUTLINE_W = 2.2;
const TAU = Math.PI * 2;

/** Agrega al path la envolvente convexa de dos círculos (una "cápsula" que puede afinarse). */
export function capsule(ctx: Ctx, x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3 || d <= Math.abs(r1 - r2)) {
    const big = r1 >= r2;
    const cx = big ? x1 : x2;
    const cy = big ? y1 : y2;
    const r = Math.max(r1, r2);
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.closePath();
    return;
  }
  const a = Math.atan2(dy, dx);
  const b = Math.acos((r1 - r2) / d);
  ctx.moveTo(x1 + r1 * Math.cos(a + b), y1 + r1 * Math.sin(a + b));
  ctx.arc(x1, y1, r1, a + b, a - b + TAU);
  ctx.arc(x2, y2, r2, a - b, a + b);
  ctx.closePath();
}

/**
 * Dibuja varias piezas como una sola silueta: primero todos los contornos y
 * después todos los rellenos, de modo que las uniones internas no se ven.
 */
function group(ctx: Ctx, parts: Part[], outline: string): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = OUTLINE_W * 2;
  ctx.strokeStyle = outline;
  for (const p of parts) {
    ctx.beginPath();
    p.path(ctx);
    ctx.stroke();
  }
  for (const p of parts) {
    ctx.beginPath();
    p.path(ctx);
    ctx.fillStyle = p.fill;
    ctx.fill();
  }
}

function leg(jx: number, jy: number, fx: number, fy: number, fill: string): Part[] {
  return [
    { path: (c) => capsule(c, jx, jy, 6.6, fx, fy, 5), fill },
    { path: (c) => capsule(c, fx, fy, 4.6, fx + 6.5, fy + 0.4, 4.3), fill },
  ];
}

export function drawDog(ctx: Ctx, p: Pose, ex: DrawExtras, pal: Palette = DACHSHUND): void {
  const O = pal.outline;
  ctx.lineCap = 'round';

  // --- Cola (detrás del cuerpo)
  {
    const lens = [12, 11, 9];
    const radii = [4.8, 3.8, 2.8, 1.7];
    const parts: Part[] = [];
    let x = p.rumpX - 11;
    let y = p.rumpY - 5;
    let a = p.tailAng + ex.wag;
    for (let i = 0; i < 3; i++) {
      const nx = x + Math.cos(a) * lens[i];
      const ny = y + Math.sin(a) * lens[i];
      const x0 = x, y0 = y, r0 = radii[i], r1 = radii[i + 1];
      parts.push({ path: (c) => capsule(c, x0, y0, r0, nx, ny, r1), fill: pal.fur });
      x = nx;
      y = ny;
      a += p.tailCurl + ex.wagLag * 0.7;
    }
    group(ctx, parts, O);
  }

  // --- Patas del lado lejano (más oscuras)
  group(
    ctx,
    [
      ...leg(p.rumpX - 7, p.rumpY + 8, p.rfx2, p.rfy2, pal.furDark),
      ...leg(p.chestX - 10, p.chestY + 8, p.ffx2, p.ffy2, pal.furDark),
    ],
    O,
  );

  // --- Hocico: geometría compartida por mandíbula, nariz y boca
  const sa = p.snoutAng;
  const dirX = Math.cos(sa), dirY = Math.sin(sa);
  const perpX = -dirY, perpY = dirX; // "abajo" del hocico
  const sbX = p.headX + 9, sbY = p.headY + 3.5;
  const tipX = sbX + dirX * 28, tipY = sbY + dirY * 28;
  const sn = (u: number, v: number): [number, number] => [tipX + dirX * u + perpX * v, tipY + dirY * u + perpY * v];

  // --- Mandíbula, interior de la boca y lengua (solo con la boca abierta)
  if (p.mouthOpen > 0.03) {
    const ja = sa + 0.05 + p.mouthOpen * 0.6;
    const jdX = Math.cos(ja), jdY = Math.sin(ja);
    const jpX = -jdY, jpY = jdX;
    const hX = sbX - dirX * 2 + perpX * 2, hY = sbY - dirY * 2 + perpY * 2;
    const jtX = hX + jdX * 23, jtY = hY + jdY * 23;
    group(
      ctx,
      [{
        path: (c) => {
          c.moveTo(hX, hY);
          c.lineTo(tipX - dirX * 2 + perpX * 3, tipY - dirY * 2 + perpY * 3);
          c.lineTo(jtX, jtY);
          c.closePath();
        },
        fill: pal.mouth,
      }],
      O,
    );
    group(ctx, [{ path: (c) => capsule(c, hX, hY, 5.5, jtX, jtY, 3.2), fill: pal.fur }], O);
    if (p.tongue > 0.05) {
      const t = p.tongue;
      const t0x = hX + jdX * 12 - jpX * 2.5, t0y = hY + jdY * 12 - jpY * 2.5;
      const t1x = hX + jdX * (22 + 4 * t) + jpX * (4 * t - 1.5), t1y = hY + jdY * (22 + 4 * t) + jpY * (4 * t - 1.5);
      group(ctx, [{ path: (c) => capsule(c, t0x, t0y, 3.2, t1x, t1y, 3.4), fill: pal.tongue }], O);
    }
  }

  // --- Silueta principal: cuerpo, patas cercanas, cuello, cabeza y hocico
  const chestR = 17.5 + ex.breath * 0.7;
  const neckAx = p.chestX + 4, neckAy = p.chestY - 7;
  const neckBx = p.headX - 3, neckBy = p.headY + 5;
  const main: Part[] = [
    { path: (c) => capsule(c, p.rumpX, p.rumpY, 15, p.chestX, p.chestY, chestR), fill: pal.fur },
  ];
  if (p.haunch > 0.01) {
    const hr = 8 + 6.5 * p.haunch;
    main.push({ path: (c) => capsule(c, p.rumpX + 6, p.rumpY + 2, hr, p.rumpX + 6, p.rumpY + 2, hr), fill: pal.fur });
  }
  if (p.scruff > 0.02) {
    // Pellejo de la nuca estirado hacia la mano que lo sostiene.
    const bx = p.chestX - 12, by = p.chestY - 11;
    main.push({ path: (c) => capsule(c, bx, by, 9, bx + 3 * p.scruff, by - 12 * p.scruff, 3.6), fill: pal.fur });
  }
  main.push(
    ...leg(p.rumpX + 2, p.rumpY + 9, p.rfx, p.rfy, pal.fur),
    ...leg(p.chestX - 2, p.chestY + 9, p.ffx, p.ffy, pal.fur),
    { path: (c) => capsule(c, neckAx, neckAy, 12.5, neckBx, neckBy, 11), fill: pal.fur },
    { path: (c) => capsule(c, p.headX, p.headY, 16.5, p.headX, p.headY, 16.5), fill: pal.fur },
    { path: (c) => capsule(c, sbX, sbY, 10, tipX, tipY, 6.3), fill: pal.fur },
  );
  group(ctx, main, O);

  // --- Líneas interiores: hombro y muslo, para que las patas no se pierdan en el cuerpo
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = O;
  ctx.beginPath();
  ctx.arc(p.chestX - 2, p.chestY + 9, 6.6, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.beginPath();
  if (p.haunch > 0.3) {
    ctx.arc(p.rumpX + 6, p.rumpY + 2, 8 + 6.5 * p.haunch - 1, Math.PI * 1.2, Math.PI * 2.15);
  } else {
    ctx.arc(p.rumpX + 2, p.rumpY + 9, 6.6, Math.PI * 1.05, Math.PI * 1.95);
  }
  ctx.stroke();
  ctx.restore();

  // --- Collar con chapita
  {
    const nx = neckBx - neckAx, ny = neckBy - neckAy;
    const nl = Math.hypot(nx, ny) || 1;
    const ux = nx / nl, uy = ny / nl;
    const mx = -uy, my = ux;
    const t = 0.3;
    const cx = neckAx + nx * t, cy = neckAy + ny * t;
    const hw = 12.5 + (11 - 12.5) * t + 0.6;
    // El extremo "de abajo/adelante" es el que tiene y mayor.
    const s = my >= 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx - mx * hw, cy - my * hw);
    ctx.lineTo(cx + mx * hw, cy + my * hw);
    ctx.lineWidth = 5.4 + OUTLINE_W * 1.6;
    ctx.strokeStyle = O;
    ctx.stroke();
    ctx.lineWidth = 5.4;
    ctx.strokeStyle = pal.collar;
    ctx.stroke();
    const tx = cx + mx * hw * s * 0.72 - ux * 0.5, ty = cy + my * hw * s * 0.72 + 4.5;
    ctx.beginPath();
    ctx.arc(tx, ty, 3.3, 0, TAU);
    ctx.lineWidth = OUTLINE_W * 1.5;
    ctx.strokeStyle = O;
    ctx.stroke();
    ctx.fillStyle = pal.tag;
    ctx.fill();
  }

  // --- Oreja
  {
    const rx = p.headX - 9, ry = p.headY - 8;
    const ea = Math.PI / 2 + p.earAng;
    const ex2 = rx + Math.cos(ea) * 23, ey2 = ry + Math.sin(ea) * 23;
    group(ctx, [{ path: (c) => capsule(c, rx, ry, 5.5, ex2, ey2, 9), fill: pal.furDark }], O);
  }

  // --- Ojo
  {
    const ex0 = p.headX + 7.5, ey0 = p.headY - 5;
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.eye;
    if (p.eyeHappy > 0.5) {
      ctx.beginPath();
      ctx.arc(ex0, ey0 + 2.5, 4, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    } else if (p.eyeOpen < 0.22) {
      ctx.beginPath();
      ctx.arc(ex0, ey0 - 2.5, 4, Math.PI * 0.14, Math.PI * 0.86);
      ctx.stroke();
    } else {
      const open = Math.min(p.eyeOpen, 1.3);
      ctx.beginPath();
      ctx.ellipse(ex0, ey0, 3.4, 3.9 * open, 0, 0, TAU);
      ctx.fillStyle = pal.eye;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex0 + 1.1, ey0 - 1.4 * open, 1.25, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  // --- Nariz
  {
    const [nx, ny] = sn(4.2, -1.6);
    ctx.beginPath();
    ctx.ellipse(nx, ny, 4.6, 3.9, sa, 0, TAU);
    ctx.fillStyle = pal.nose;
    ctx.fill();
  }

  // --- Boca cerrada: una sonrisa suave
  if (p.mouthOpen <= 0.03) {
    const [m0x, m0y] = sn(1.5, 3.2);
    const [m1x, m1y] = sn(-8, 5.4);
    const [m2x, m2y] = sn(-16, 2.6);
    ctx.beginPath();
    ctx.moveTo(m0x, m0y);
    ctx.quadraticCurveTo(m1x, m1y, m2x, m2y);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = O;
    ctx.stroke();
  }
}

/**
 * El perro visto de frente, colgando del pellejo. El origen es el punto de la
 * nuca del que lo sostienen; el cuerpo cuelga hacia abajo (+y).
 * `t` es el tiempo en segundos (mueve patas y cola) y `eyeOpen` permite parpadear.
 */
export function drawDogFront(ctx: Ctx, t: number, eyeOpen: number, pal: Palette = DACHSHUND): void {
  const O = pal.outline;
  ctx.lineCap = 'round';
  const kick = Math.sin(t * 7) * 2.5;
  const tailX = Math.sin(t * 5) * 9;

  // Cola, detrás de todo.
  group(ctx, [{ path: (c) => capsule(c, 0, 122, 4.2, tailX, 146, 2) , fill: pal.fur }], O);

  // Patas traseras colgando.
  const hind = (side: number, k: number): Part[] => [
    { path: (c) => capsule(c, side * 10, 112, 7.5, side * 13 + k, 134, 5.6), fill: pal.furDark },
    { path: (c) => capsule(c, side * 13 + k, 136, 6, side * 13 + k, 137, 6), fill: pal.furDark },
  ];
  group(ctx, [...hind(-1, kick), ...hind(1, -kick)], O);

  // Pellejo, cuerpo y cabeza como una sola silueta.
  group(
    ctx,
    [
      { path: (c) => capsule(c, 0, 2, 3.8, 0, 14, 9), fill: pal.fur },
      { path: (c) => capsule(c, 0, 62, 16.5, 0, 114, 17.5), fill: pal.fur },
      { path: (c) => capsule(c, 0, 31, 22.5, 0, 31, 22.5), fill: pal.fur },
    ],
    O,
  );

  // Panza más clara.
  ctx.beginPath();
  capsule(ctx, 0, 74, 8.5, 0, 112, 10.5);
  ctx.fillStyle = pal.furLight;
  ctx.fill();

  // Patas delanteras, flojas sobre el pecho.
  const front = (side: number, k: number): Part[] => [
    { path: (c) => capsule(c, side * 13, 66, 6.5, side * 15 + k, 88, 5.4), fill: pal.fur },
    { path: (c) => capsule(c, side * 15 + k, 90, 5.8, side * 15 + k, 91, 5.8), fill: pal.fur },
  ];
  group(ctx, front(-1, -kick), O);
  group(ctx, front(1, kick), O);

  // Collar con chapita.
  ctx.beginPath();
  ctx.moveTo(-14, 53);
  ctx.quadraticCurveTo(0, 58, 14, 53);
  ctx.lineWidth = 5.4 + OUTLINE_W * 1.6;
  ctx.strokeStyle = O;
  ctx.stroke();
  ctx.lineWidth = 5.4;
  ctx.strokeStyle = pal.collar;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 60.5, 3.4, 0, TAU);
  ctx.lineWidth = OUTLINE_W * 1.5;
  ctx.strokeStyle = O;
  ctx.stroke();
  ctx.fillStyle = pal.tag;
  ctx.fill();

  // Orejas largas a los lados.
  for (const side of [-1, 1]) {
    group(ctx, [{ path: (c) => capsule(c, side * 20, 19, 5.5, side * 29, 49, 9.5), fill: pal.furDark }], O);
  }

  // Hocico, nariz y boca.
  ctx.beginPath();
  ctx.ellipse(0, 39, 12, 9, 0, 0, TAU);
  ctx.fillStyle = pal.furLight;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = O;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 35, 5.4, 4, 0, 0, TAU);
  ctx.fillStyle = pal.nose;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-5, 42.5);
  ctx.quadraticCurveTo(-2.2, 45.5, 0, 42);
  ctx.quadraticCurveTo(2.2, 45.5, 5, 42.5);
  ctx.stroke();

  // Ojos bien abiertos.
  for (const side of [-1, 1]) {
    const ex = side * 9.5, ey = 26;
    if (eyeOpen < 0.22) {
      ctx.beginPath();
      ctx.arc(ex, ey - 2.5, 4, Math.PI * 0.14, Math.PI * 0.86);
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.eye;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(ex, ey, 3.6, 4.2, 0, 0, TAU);
      ctx.fillStyle = pal.eye;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 1.1, ey - 1.5, 1.3, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }
}
