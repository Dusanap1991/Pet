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
const SVG = `
<svg viewBox="-12 -12 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle r="10.6" fill="#E8463A" stroke="#3A2212" stroke-width="2.4"/>
  <path d="M-10 -1.5 C -4 3, 4 3, 10 -1.5" fill="none" stroke="#FFF4DC" stroke-width="2.6" stroke-linecap="round"/>
  <ellipse cx="-3.8" cy="-5" rx="2.6" ry="1.6" fill="#fff" opacity=".55"/>
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
    parent.appendChild(this.el);
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
  }

  /** ¿Se está moviendo? (para dibujar a pleno ritmo). */
  get moving(): boolean {
    return this.holder === 'user' || (this.holder === 'none' && (this.vx !== 0 || this.vy !== 0 || !this.onFloor));
  }

  remove(): void {
    this.el.remove();
  }
}
