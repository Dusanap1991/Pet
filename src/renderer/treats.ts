import type { TreatTarget } from './dog/dog';

/** Premios y comida: con sombra, volumen y luz, para que calcen con el perro realista. */
export type TreatKind = 'cookie' | 'bone' | 'sausage';

const SVG: Record<TreatKind, { svg: string; w: number; h: number }> = {
  // Galleta para perro redonda, tostada y con puntitos.
  cookie: {
    w: 30,
    h: 14,
    svg: `<svg viewBox="0 0 30 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="ck" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#E9B573"/><stop offset=".7" stop-color="#C0813F"/><stop offset="1" stop-color="#8E5626"/></radialGradient>
  </defs>
  <ellipse cx="15" cy="8" rx="14" ry="5.6" fill="#7A4A20"/>
  <ellipse cx="15" cy="6.6" rx="14" ry="5.4" fill="url(#ck)"/>
  <g fill="#8B5424" opacity=".7"><circle cx="9" cy="6" r=".9"/><circle cx="14" cy="4.6" r=".9"/><circle cx="19.5" cy="6.4" r=".9"/><circle cx="12" cy="8.2" r=".9"/><circle cx="17" cy="8.6" r=".9"/><circle cx="22.5" cy="5" r=".8"/></g>
  <ellipse cx="11" cy="4.6" rx="5" ry="1.3" fill="#fff" opacity=".22"/>
</svg>`,
  },
  // Hueso prensado color marfil, con sombreado.
  bone: {
    w: 44,
    h: 18,
    svg: `<svg viewBox="0 0 44 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="bn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6E2"/><stop offset=".55" stop-color="#EBD6B0"/><stop offset="1" stop-color="#B99A6B"/></linearGradient>
  </defs>
  <g fill="url(#bn)" stroke="#A88A5C" stroke-width=".8">
    <circle cx="7" cy="6" r="4.6"/><circle cx="7" cy="12.5" r="4.6"/>
    <circle cx="37" cy="6" r="4.6"/><circle cx="37" cy="12.5" r="4.6"/>
    <rect x="7" y="5.2" width="30" height="8" rx="3"/>
  </g>
  <rect x="7.5" y="6" width="29" height="6.5" rx="3" fill="url(#bn)"/>
  <path d="M10 7.4 H34" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>
</svg>`,
  },
  // Salchichita, su favorita.
  sausage: {
    w: 40,
    h: 15,
    svg: `<svg viewBox="0 0 40 15" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="ss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9775A"/><stop offset=".5" stop-color="#A8442A"/><stop offset="1" stop-color="#6E2614"/></linearGradient>
  </defs>
  <path d="M5 8 C5 3.5 9 2.5 20 2.5 C31 2.5 35 3.5 35 8 C35 12.5 31 13 20 13 C9 13 5 12.5 5 8 Z" fill="url(#ss)"/>
  <path d="M3 8 L5 7 L5 9 Z M37 8 L35 7 L35 9 Z" fill="#5A2010"/>
  <path d="M10 5 C15 4 25 4 30 5" stroke="#FFD2C2" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".6"/>
</svg>`,
  },
};

const BOWL_SVG = `<svg viewBox="0 0 90 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="bw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7C8794"/><stop offset=".3" stop-color="#E9EEF3"/><stop offset=".55" stop-color="#B7C1CC"/><stop offset="1" stop-color="#5F6A76"/></linearGradient>
    <radialGradient id="kb" cx="45%" cy="30%" r="70%"><stop offset="0" stop-color="#B8763C"/><stop offset="1" stop-color="#6E3E18"/></radialGradient>
  </defs>
  <g class="food">
    <ellipse cx="45" cy="15" rx="33" ry="9" fill="url(#kb)"/>
    <g fill="#8A4F22" stroke="#5A3214" stroke-width=".6">
      <ellipse cx="30" cy="12" rx="4" ry="2.6"/><ellipse cx="40" cy="9" rx="4" ry="2.6"/><ellipse cx="51" cy="10" rx="4" ry="2.6"/>
      <ellipse cx="61" cy="13" rx="4" ry="2.6"/><ellipse cx="35" cy="16" rx="4" ry="2.6"/><ellipse cx="46" cy="15" rx="4" ry="2.6"/><ellipse cx="57" cy="17" rx="4" ry="2.6"/>
    </g>
  </g>
  <path d="M6 16 C8 32 20 38 45 38 C70 38 82 32 84 16 Z" fill="url(#bw)"/>
  <ellipse cx="45" cy="16" rx="39" ry="7" fill="none" stroke="#DCE3EA" stroke-width="2.4"/>
  <ellipse cx="45" cy="16" rx="39" ry="7" fill="none" stroke="#4E5864" stroke-width=".7"/>
  <path d="M16 24 C22 31 34 33 42 33" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".45"/>
</svg>`;

/** Cuánto llena cada cosa (lo usa el ánimo del perro). */
export const FOOD_NAME: Record<TreatKind, string> = { cookie: 'galleta', bone: 'hueso', sausage: 'salchicha' };

abstract class Item implements TreatTarget {
  y = 0;
  vy = 0;
  landed = false;
  bounced = false;
  hidden = false;
  readonly el: HTMLDivElement;
  readonly shadow: HTMLDivElement;
  abstract readonly w: number;
  abstract readonly h: number;
  eatTime?: number;

  constructor(public x: number, parent: HTMLElement, className: string, html: string) {
    this.shadow = document.createElement('div');
    this.shadow.className = 'prop-shadow';
    this.el = document.createElement('div');
    this.el.className = className;
    this.el.innerHTML = html;
    parent.append(this.shadow, this.el);
  }

  remove(): void {
    this.el.remove();
    this.shadow.remove();
  }
}

class Treat extends Item {
  readonly w: number;
  readonly h: number;

  constructor(x: number, readonly kind: TreatKind, scale: number, parent: HTMLElement) {
    super(x, parent, 'treat', SVG[kind].svg);
    this.w = SVG[kind].w * scale * 0.95;
    this.h = SVG[kind].h * scale * 0.95;
    this.el.style.width = `${this.w}px`;
    this.y = -60;
  }
}

/** Plato de comida: el perro come varios segundos y el plato se va vaciando. */
class Bowl extends Item {
  readonly w: number;
  readonly h: number;
  private fill = 1;
  private fadeAt = 0;
  readonly kind = 'meal';

  constructor(x: number, scale: number, parent: HTMLElement) {
    super(x, parent, 'treat bowl', BOWL_SVG);
    this.w = 74 * scale;
    this.h = this.w * (40 / 90);
    this.el.style.width = `${this.w}px`;
    this.landed = true;
    this.eatTime = 5.5;
    this.el.classList.add('appear');
  }

  /** Avance de la comida (0 = lleno, 1 = vacío). */
  progress(p: number): void {
    this.fill = Math.max(0, 1 - p);
    const food = this.el.querySelector<SVGGElement>('.food');
    if (food) {
      food.style.transformOrigin = '45px 26px';
      food.style.transform = `translateY(${(1 - this.fill) * 7}px) scaleX(${0.6 + 0.4 * this.fill})`;
      food.style.opacity = String(this.fill > 0.02 ? 1 : 0);
    }
  }

  /** Vacío: se queda un rato y después desaparece. */
  emptied(now: number): void {
    this.progress(1);
    this.fadeAt = now + 15_000;
  }

  shouldRemove(now: number): boolean {
    return this.fadeAt > 0 && now >= this.fadeAt;
  }
}

/** Premios que caen, el plato de comida y los premios escondidos. */
export class Treats {
  private list: Item[] = [];

  constructor(private parent: HTMLElement) {}

  get active(): boolean {
    return this.list.some((t) => !t.landed);
  }

  /** Un premio que cae (desde arriba, donde está `x`). */
  spawn(x: number, scale: number, kind: TreatKind = 'bone'): void {
    this.list.push(new Treat(x, kind, scale, this.parent));
  }

  /** Sirve el plato en `x` (si ya hay uno, lo rellena). */
  serve(x: number, scale: number): void {
    const old = this.list.find((t) => t instanceof Bowl) as Bowl | undefined;
    if (old) this.remove(old);
    this.list.push(new Bowl(x, scale, this.parent));
  }

  /** Esconde un premio en `x`: no se ve hasta que el perro lo encuentra olfateando. */
  hide(x: number, scale: number, kind: TreatKind): void {
    const t = new Treat(x, kind, scale, this.parent);
    t.hidden = true;
    t.landed = true;
    t.el.style.visibility = 'hidden';
    t.shadow.style.visibility = 'hidden';
    this.list.push(t);
  }

  hiddenOne(): TreatTarget | null {
    return this.list.find((t) => t.hidden) ?? null;
  }

  /** El perro lo encontró: aparece con un pequeño salto. */
  reveal(target: TreatTarget): void {
    const t = target as Item;
    t.hidden = false;
    t.el.style.visibility = '';
    t.shadow.style.visibility = '';
    t.el.classList.add('found');
  }

  update(dt: number, floorY: number): void {
    const now = performance.now();
    for (const t of [...this.list]) {
      if (t instanceof Bowl && t.shouldRemove(now)) {
        t.el.classList.add('leave');
        setTimeout(() => this.remove(t), 600);
        continue;
      }
      const ground = floorY - t.h + 2;
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
      t.el.style.transform = `translate(${Math.round(t.x - t.w / 2)}px, ${Math.round(t.y)}px)`;
      // Sombra en el suelo: más chica y tenue mientras el premio va en el aire.
      const air = Math.min(1, Math.max(0, (ground - t.y) / 160));
      const sw = t.w * (1.05 - 0.45 * air);
      t.shadow.style.width = `${sw}px`;
      t.shadow.style.height = `${Math.max(4, t.h * 0.32)}px`;
      t.shadow.style.opacity = String(0.55 * (1 - air));
      t.shadow.style.transform = `translate(${Math.round(t.x - sw / 2)}px, ${Math.round(floorY - t.h * 0.16)}px)`;
    }
  }

  nearest(x: number): TreatTarget | null {
    let best: Item | null = null;
    for (const t of this.list) {
      if (t.hidden || !t.landed || (t instanceof Bowl && (t as Bowl).shouldRemove(Infinity))) continue;
      if (t instanceof Bowl && t.eatTime === undefined) continue;
      if (!best || Math.abs(t.x - x) < Math.abs(best.x - x)) best = t;
    }
    return best;
  }

  kindOf(target: TreatTarget): TreatKind | 'meal' {
    return target instanceof Bowl ? 'meal' : (target as Treat).kind;
  }

  /** Se lo comió: los premios desaparecen; el plato queda vacío un rato. */
  remove(target: TreatTarget): void {
    const t = target as Item;
    if (t instanceof Bowl && t.eatTime !== undefined) {
      t.eatTime = undefined;
      t.emptied(performance.now());
      return;
    }
    const i = this.list.indexOf(t);
    if (i < 0) return;
    t.remove();
    this.list.splice(i, 1);
  }
}
