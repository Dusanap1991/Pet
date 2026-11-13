import type { TreatTarget } from './dog/dog';

const BONE_SVG = `
<svg viewBox="0 0 44 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="#3A2212" stroke="#3A2212" stroke-width="4" stroke-linejoin="round">
    <circle cx="9" cy="7.5" r="5"/><circle cx="9" cy="16.5" r="5"/>
    <circle cx="35" cy="7.5" r="5"/><circle cx="35" cy="16.5" r="5"/>
    <rect x="9" y="8" width="26" height="8"/>
  </g>
  <g fill="#FFF4DC">
    <circle cx="9" cy="7.5" r="5"/><circle cx="9" cy="16.5" r="5"/>
    <circle cx="35" cy="7.5" r="5"/><circle cx="35" cy="16.5" r="5"/>
    <rect x="9" y="8" width="26" height="8"/>
  </g>
</svg>`;

class Treat implements TreatTarget {
  y = -40;
  vy = 0;
  landed = false;
  bounced = false;
  readonly el: HTMLDivElement;

  constructor(public x: number, readonly size: number, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'treat';
    this.el.style.width = `${size}px`;
    this.el.innerHTML = BONE_SVG;
    parent.appendChild(this.el);
  }
}

/** Huesos que caen del cielo y esperan en el suelo a que el perro llegue. */
export class Treats {
  private list: Treat[] = [];

  constructor(private parent: HTMLElement) {}

  get active(): boolean {
    return this.list.some((t) => !t.landed);
  }

  spawn(x: number, scale: number): void {
    this.list.push(new Treat(x, 34 * scale, this.parent));
  }

  update(dt: number, floorY: number): void {
    for (const t of this.list) {
      const h = t.size * (24 / 44);
      const ground = floorY - h + 2;
      if (!t.landed) {
        t.vy += 2300 * dt;
        t.y += t.vy * dt;
        if (t.y >= ground) {
          t.y = ground;
          if (!t.bounced && t.vy > 300) {
            t.vy = -t.vy * 0.32;
            t.bounced = true;
          } else {
            t.vy = 0;
            t.landed = true;
          }
        }
      } else {
        t.y = ground;
      }
      t.el.style.transform = `translate(${Math.round(t.x - t.size / 2)}px, ${Math.round(t.y)}px)`;
    }
  }

  nearest(x: number): TreatTarget | null {
    let best: Treat | null = null;
    for (const t of this.list) {
      if (t.landed && (!best || Math.abs(t.x - x) < Math.abs(best.x - x))) best = t;
    }
    return best;
  }

  remove(target: TreatTarget): void {
    const i = this.list.indexOf(target as Treat);
    if (i < 0) return;
    this.list[i].el.remove();
    this.list.splice(i, 1);
  }
}
