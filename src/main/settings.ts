import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PetSize } from '../shared/types';

export interface Settings {
  size: PetSize;
  breakReminders: boolean;
  breakEveryMin: number;
  /** Pantalla donde vive el perro; sin valor, la principal. */
  displayId?: number;
}

export const DEFAULT_SETTINGS: Settings = { size: 'm', breakReminders: true, breakEveryMin: 50 };

export const BREAK_CHOICES = [30, 50, 90] as const;

/** Acepta cualquier cosa leída del disco y devuelve una configuración válida. */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (r.size === 's' || r.size === 'm' || r.size === 'l') out.size = r.size;
  if (typeof r.breakReminders === 'boolean') out.breakReminders = r.breakReminders;
  if (typeof r.breakEveryMin === 'number' && r.breakEveryMin >= 5 && r.breakEveryMin <= 240) {
    out.breakEveryMin = Math.round(r.breakEveryMin);
  }
  if (typeof r.displayId === 'number' && Number.isFinite(r.displayId)) out.displayId = r.displayId;
  return out;
}

export function loadSettings(file: string): Settings {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, settings: Settings): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('No se pudo guardar la configuración:', err);
  }
}
