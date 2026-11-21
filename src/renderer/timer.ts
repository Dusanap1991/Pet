/** Etiqueta junto al perro con lo que queda del foco o del Pomodoro ("🍅 18:42"). */
export class TimerPill {
  private readonly el: HTMLDivElement;
  private endsAt: number | null = null;
  private lastText = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'timer-pill';
    this.el.setAttribute('role', 'timer');
    parent.appendChild(this.el);
  }

  set(endsAt: number | null, icon: string, label: string): void {
    this.endsAt = endsAt;
    this.el.dataset.icon = icon;
    this.el.title = label;
    this.el.classList.toggle('show', endsAt !== null);
  }

  /** Detrás del perro (del lado de la cola), a la altura del suelo. */
  update(dogX: number, floorY: number, facing: 1 | -1, scale: number): void {
    if (this.endsAt === null) return;
    const left = Math.max(0, this.endsAt - Date.now());
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    const text = `${this.el.dataset.icon ?? ''} ${m}:${String(s).padStart(2, '0')}`;
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.lastText = text;
    }
    const w = this.el.offsetWidth;
    const x = dogX - facing * 118 * scale - w / 2;
    this.el.style.transform = `translate(${Math.round(Math.max(6, x))}px, ${Math.round(floorY - 30 * scale)}px)`;
  }
}
