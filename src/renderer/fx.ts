/** Partículas sueltas alrededor del perro: corazones, "z" de sueño, "!" y migas. */

type Kind = 'heart' | 'z' | 'bang' | 'crumb';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  gravity: number;
}

const OUTLINE = '#3A2212';
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Fx {
  private items: Particle[] = [];

  get active(): boolean {
    return this.items.length > 0;
  }

  heart(x: number, y: number, s: number): void {
    this.items.push({
      kind: 'heart', x: x + rand(-10, 10) * s, y, vx: rand(-14, 14) * s, vy: -rand(34, 52) * s,
      life: 0, max: 1.3, size: rand(6.5, 9) * s, gravity: 0,
    });
  }

  z(x: number, y: number, s: number): void {
    this.items.push({ kind: 'z', x, y, vx: 10 * s, vy: -17 * s, life: 0, max: 2.4, size: 12 * s, gravity: 0 });
  }

  bang(x: number, y: number, s: number): void {
    this.items.push({ kind: 'bang', x, y, vx: 0, vy: -10 * s, life: 0, max: 0.75, size: 22 * s, gravity: 0 });
  }

  crumb(x: number, y: number, s: number): void {
    this.items.push({
      kind: 'crumb', x, y, vx: rand(-60, 60) * s, vy: -rand(40, 95) * s,
      life: 0, max: 0.55, size: rand(1.4, 2.6) * s, gravity: 420 * s,
    });
  }

  update(dt: number): void {
    for (const p of this.items) {
      p.life += dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'heart') p.x += Math.sin(p.life * 7) * 12 * dt;
    }
    this.items = this.items.filter((p) => p.life < p.max);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const k = p.life / p.max;
      const alpha = Math.min(1, p.life / 0.1) * (k > 0.65 ? (1 - k) / 0.35 : 1);
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(p.x, p.y);
      switch (p.kind) {
        case 'heart': {
          const r = p.size * Math.min(1, 0.4 + p.life * 4);
          ctx.beginPath();
          ctx.moveTo(0, r * 0.9);
          ctx.bezierCurveTo(-r * 1.6, -r * 0.2, -r * 0.8, -r * 1.3, 0, -r * 0.45);
          ctx.bezierCurveTo(r * 0.8, -r * 1.3, r * 1.6, -r * 0.2, 0, r * 0.9);
          ctx.closePath();
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(1.5, p.size * 0.32);
          ctx.strokeStyle = OUTLINE;
          ctx.stroke();
          ctx.fillStyle = '#FF5C7A';
          ctx.fill();
          break;
        }
        case 'z':
        case 'bang': {
          const size = p.kind === 'z' ? p.size * (0.7 + k * 0.7) : p.size * Math.min(1, 0.5 + p.life * 6);
          ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2.5, size * 0.22);
          ctx.strokeStyle = OUTLINE;
          const text = p.kind === 'z' ? 'z' : '!';
          ctx.strokeText(text, 0, 0);
          ctx.fillStyle = p.kind === 'z' ? '#FFFFFF' : '#FFD23F';
          ctx.fillText(text, 0, 0);
          break;
        }
        case 'crumb': {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fillStyle = '#F3E3BF';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = OUTLINE;
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    }
  }
}
