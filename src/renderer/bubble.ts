/** Globo de texto sobre la cabeza del perro. */
export class Bubble {
  private el: HTMLDivElement;
  private hideAt = 0;
  private shown = false;
  private w = 0;
  private h = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'bubble';
    parent.appendChild(this.el);
  }

  say(text: string, ms = 4000): void {
    this.el.textContent = text;
    this.el.classList.add('show');
    this.shown = true;
    this.hideAt = performance.now() + ms;
    this.w = this.el.offsetWidth;
    this.h = this.el.offsetHeight;
  }

  dismiss(): void {
    this.hideAt = 0;
  }

  /** `headX`/`headTop` en píxeles de la ventana. */
  update(now: number, headX: number, headTop: number, viewportW: number): void {
    if (!this.shown) return;
    if (now >= this.hideAt) {
      this.shown = false;
      this.el.classList.remove('show');
      return;
    }
    const left = Math.max(8, Math.min(viewportW - this.w - 8, headX - this.w / 2));
    const top = Math.max(8, headTop - this.h - 14);
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    const tail = Math.max(18, Math.min(this.w - 18, headX - left));
    this.el.style.setProperty('--tail', `${Math.round(tail)}px`);
  }
}
