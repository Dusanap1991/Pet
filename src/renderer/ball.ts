/** La pelota: se lanza con el mouse, rebota, rueda y el perro la trae de vuelta. */

export type BallHolder = 'none' | 'user' | 'dog';

/** Lo que el perro necesita saber de la pelota. */
export interface BallTarget {
  readonly x: number;
  readonly y: number;
  readonly holder: BallHolder;
  /** En el suelo y casi quieta: se puede agarrar con la boca. */
  readonly grabbable: boolean;
  /** Cambia cada vez que la lanzas: así el perro sabe que hay que ir a buscarla. */
  readonly throwId: number;
}

const GRAVITY = 2300;
// Pelota de tenis: fieltro amarillo verdoso, costura blanca y luz de arriba a la izquierda.
const SVG = `
<svg viewBox="-12 -12 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="tb" cx="-0.35" cy="-0.4" r="1.25" gradientUnits="objectBoundingBox" fx="0.32" fy="0.3">
      <stop offset="0" stop-color="#F4FF8A"/><stop offset=".55" stop-color="#C9E030"/><stop offset="1" stop-color="#7E9614"/>
    </radialGradient>
  </defs>
  <circle r="11" fill="url(#tb)"/>
  <path d="M-8.2 -7.2 C-2.5 -3 -2.5 3 -8.2 7.2 M8.2 -7.2 C2.5 -3 2.5 3 8.2 7.2" fill="none" stroke="#FBFBF2" stroke-width="1.6" stroke-linecap="round"/>
  <circle r="11" fill="none" stroke="#6B7F10" stroke-width=".7" opacity=".6"/>
</svg>`;

export class Ball implements BallTarget {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  holder: BallHolder = 'none';
  throwId = 1;
  private spin = 0;
  private readonly el: HTMLDivElement;
  private readonly shadow: HTMLDivElement;
  private floorY = 0;
  /** Radio en píxeles. */
  readonly r: number;
  /** Para calcular con qué fuerza la lanzas. */
  private trail: { x: number; y: number; t: number }[] = [];

  constructor(parent: HTMLElement, x: number, y: number, scale: number) {
    this.r = 11 * scale;
    this.x = x;
    this.y = y;
    this.el = document.createElement('div');
    this.el.className = 'ball';
    this.el.style.width = `${this.r * 2}px`;
    this.el.style.height = `${this.r * 2}px`;
    this.el.innerHTML = SVG;
    this.shadow = document.createElement('div');
    this.shadow.className = 'prop-shadow';
    parent.append(this.shadow, this.el);
  }

  get grabbable(): boolean {
    return this.holder === 'none' && this.onFloor && Math.abs(this.vx) < 260;
  }

  private onFloorY = Infinity;
  private get onFloor(): boolean {
    return this.y >= this.onFloorY - 1;
  }

  hitTest(px: number, py: number): boolean {
    return Math.hypot(px - this.x, py - this.y) <= this.r + 8;
  }

  grab(): void {
    this.holder = 'user';
    this.vx = 0;
    this.vy = 0;
    this.trail = [];
  }

  dragTo(x: number, y: number, floorY: number): void {
    this.x = x;
    this.y = Math.min(y, floorY - this.r);
    const t = performance.now();
    this.trail.push({ x: this.x, y: this.y, t });
    this.trail = this.trail.filter((p) => t - p.t < 120);
  }

  /** Suelta con la velocidad de los últimos ~0,1 s de arrastre. */
  throw(): void {
    const first = this.trail[0];
    const last = this.trail[this.trail.length - 1];
    if (first && last && last.t > first.t) {
      const dt = (last.t - first.t) / 1000;
      this.vx = Math.max(-2200, Math.min(2200, (last.x - first.x) / dt));
      this.vy = Math.max(-2200, Math.min(2200, (last.y - first.y) / dt));
    }
    this.holder = 'none';
    this.throwId++;
  }

  /** El perro la lleva en la boca. */
  carry(x: number, y: number): void {
    this.holder = 'dog';
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
  }

  /** El perro la deja caer frente a ti. */
  drop(vx: number): void {
    this.holder = 'none';
    this.vx = vx;
    this.vy = -120;
  }

  update(dt: number, floorY: number, width: number): void {
    const floor = floorY - this.r;
    this.onFloorY = floor;
    if (this.holder === 'none') {
      this.vy += GRAVITY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.y >= floor) {
        this.y = floor;
        this.vy = Math.abs(this.vy) > 160 ? -Math.abs(this.vy) * 0.55 : 0;
        // Rodando: el roce la va frenando.
        this.vx *= Math.exp(-1.6 * dt);
        if (Math.abs(this.vx) < 6) this.vx = 0;
      }
      if (this.x < this.r) {
        this.x = this.r;
        this.vx = Math.abs(this.vx) * 0.6;
      } else if (this.x > width - this.r) {
        this.x = width - this.r;
        this.vx = -Math.abs(this.vx) * 0.6;
      }
      if (this.y < this.r) {
        this.y = this.r;
        this.vy = Math.abs(this.vy) * 0.5;
      }
      this.spin += (this.vx * dt) / this.r;
    }
    this.el.style.transform = `translate(${Math.round(this.x - this.r)}px, ${Math.round(this.y - this.r)}px) rotate(${this.spin}rad)`;
    // Sombra en el suelo: se achica y se aclara mientras la pelota sube.
    this.floorY = floorY;
    const air = Math.min(1, Math.max(0, (floorY - this.r - this.y) / 200));
    const sw = this.r * 2.1 * (1 - 0.5 * air);
    this.shadow.style.width = `${sw}px`;
    this.shadow.style.height = `${this.r * 0.55}px`;
    this.shadow.style.opacity = String(0.6 * (1 - air) * (this.holder === 'dog' ? 0.4 : 1));
    this.shadow.style.transform = `translate(${Math.round(this.x - sw / 2)}px, ${Math.round(this.floorY - this.r * 0.3)}px)`;
  }

  /** ¿Se está moviendo? (para dibujar a pleno ritmo). */
  get moving(): boolean {
    return this.holder === 'user' || (this.holder === 'none' && (this.vx !== 0 || this.vy !== 0 || !this.onFloor));
  }

  remove(): void {
    this.el.remove();
    this.shadow.remove();
  }
}
