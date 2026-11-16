/** Utilidades comunes de las ventanas "Mi día" y "Ajustes". */
export interface PanelBridge {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  on(channel: string, cb: () => void): void;
  close(): void;
}

declare global {
  interface Window {
    petPanel: PanelBridge;
  }
}

export const panel = (): PanelBridge => window.petPanel;

export const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.petPanel.close();
});
