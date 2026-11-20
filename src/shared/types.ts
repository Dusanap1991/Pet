/** Tipos compartidos entre el proceso principal, el preload y la ventana. */

export type PetSize = 's' | 'm' | 'l';
export type Coat = 'red' | 'blacktan' | 'chocolate' | 'cream' | 'dapple';
export type Outfit = 'santa' | 'witch' | 'scarf' | null;
export type DogStyle = '2d' | '3d' | 'photo';
export type Ambient = 'off' | 'rain' | 'waves' | 'brown';

/** Mensajes que el proceso principal le manda al perro. */
export type PetEvent =
  | { type: 'cursor'; x: number; y: number }
  | { type: 'away' }
  | { type: 'back'; awaySec: number }
  | { type: 'break-due'; minutes: number }
  | { type: 'focus-start'; minutes: number }
  | { type: 'focus-end'; completed: boolean; minutes: number }
  | { type: 'treat' }
  | { type: 'water' }
  | { type: 'reminder'; text: string }
  | { type: 'notice'; text: string }
  | { type: 'settings'; size: PetSize; sound: boolean; name: string; coat: Coat; outfit: Outfit; style: DogStyle }
  | { type: 'eyes' }
  | { type: 'stretch' }
  | { type: 'ambient'; kind: Ambient }
  | { type: 'come'; x: number }
  | { type: 'mood'; joy: number; food: number }
  | { type: 'ball'; out: boolean };

/** Lo que el perro le cuenta al proceso principal (para el resumen del día y el ánimo). */
export type PetReport = 'pet' | 'treat' | 'play' | 'drank' | 'stretched';

/** API que el preload expone en `window.pet`. */
export interface PetBridge {
  onEvent(cb: (e: PetEvent) => void): void;
  /** true = la ventana recibe clics (el cursor está sobre el perro). */
  setInteractive(on: boolean): void;
  /** Avisa que lo están arrastrando, para poder llevarlo a otra pantalla. */
  setDragging(on: boolean): void;
  /** Clic derecho sobre el perro: abre su menú. */
  showMenu(): void;
  report(kind: PetReport): void;
  battery(level: number, charging: boolean): void;
  ready(): void;
}

export const SIZE_SCALE: Record<PetSize, number> = { s: 0.9, m: 1.2, l: 1.6 };
