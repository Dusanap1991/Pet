/** Tipos compartidos entre el proceso principal, el preload y la ventana. */

export type PetSize = 's' | 'm' | 'l';

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
  | { type: 'settings'; size: PetSize; sound: boolean; name: string }
  | { type: 'mood'; joy: number; food: number }
  | { type: 'ball'; out: boolean };

/** Lo que el perro le cuenta al proceso principal (para el resumen del día y el ánimo). */
export type PetReport = 'pet' | 'treat' | 'play' | 'drank';

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
