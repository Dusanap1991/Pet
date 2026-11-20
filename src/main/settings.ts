import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Ambient, Coat, DogStyle, PetSize } from '../shared/types';

export interface Settings {
  size: PetSize;
  breakReminders: boolean;
  breakEveryMin: number;
  waterReminders: boolean;
  waterEveryMin: number;
  /** macOS: esconderse solo cuando hay una app en pantalla completa. */
  hideOnFullscreen: boolean;
  /** Nombre del perro ('' = sin nombre). */
  name: string;
  sound: boolean;
  /** Dirección iCal del calendario ('' = sin calendario). */
  calendarUrl: string;
  meetingLeadMin: number;
  /** Carpeta a la que mover archivos soltados sobre el perro ('' = preguntar). */
  dropFolder: string;
  deviceAlerts: boolean;
  taskNudges: boolean;
  /** Durante una reunión del calendario, los avisos esperan a que termine. */
  quietInMeetings: boolean;
  /** Atajos de teclado globales. */
  shortcuts: boolean;
  endOfDay: boolean;
  /** "HH:MM". */
  endOfDayTime: string;
  weeklySummary: boolean;
  lateNight: boolean;
  /** Regla 20-20-20 para la vista. */
  eyeBreaks: boolean;
  weatherCity: string;
  weatherPlace: { name: string; lat: number; lon: number } | null;
  costumes: boolean;
  coat: Coat;
  style: DogStyle;
  /** Vasos de agua al día. */
  waterGoal: number;
  ambient: Ambient;
  /** El sonido ambiente solo suena durante el foco. */
  ambientFocusOnly: boolean;
  /** Pantalla donde vive el perro; sin valor, la principal. */
  displayId?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  size: 'm',
  breakReminders: true,
  breakEveryMin: 50,
  waterReminders: true,
  waterEveryMin: 45,
  hideOnFullscreen: true,
  name: '',
  sound: false,
  calendarUrl: '',
  meetingLeadMin: 5,
  dropFolder: '',
  deviceAlerts: true,
  taskNudges: true,
  quietInMeetings: true,
  shortcuts: true,
  endOfDay: true,
  endOfDayTime: '18:00',
  weeklySummary: true,
  lateNight: true,
  eyeBreaks: false,
  weatherCity: '',
  weatherPlace: null,
  costumes: true,
  coat: 'red',
  style: 'photo',
  waterGoal: 8,
  ambient: 'off',
  ambientFocusOnly: true,
};

export const WATER_GOALS = [6, 8, 10, 12] as const;

export const COATS: [Coat, string][] = [
  ['red', 'Colorado'],
  ['blacktan', 'Negro y fuego'],
  ['chocolate', 'Chocolate'],
  ['cream', 'Crema'],
  ['dapple', 'Arlequín'],
];

export const BREAK_CHOICES = [30, 50, 90] as const;
export const WATER_CHOICES = [30, 45, 60, 90] as const;
export const MEETING_LEAD_CHOICES = [1, 5, 10, 15] as const;
export const MAX_NAME = 24;

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
  if (typeof r.waterReminders === 'boolean') out.waterReminders = r.waterReminders;
  if (typeof r.waterEveryMin === 'number' && r.waterEveryMin >= 5 && r.waterEveryMin <= 240) {
    out.waterEveryMin = Math.round(r.waterEveryMin);
  }
  if (typeof r.hideOnFullscreen === 'boolean') out.hideOnFullscreen = r.hideOnFullscreen;
  if (typeof r.name === 'string') out.name = r.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (typeof r.sound === 'boolean') out.sound = r.sound;
  if (typeof r.calendarUrl === 'string' && r.calendarUrl.length <= 2000) out.calendarUrl = r.calendarUrl.trim();
  if (typeof r.meetingLeadMin === 'number' && (MEETING_LEAD_CHOICES as readonly number[]).includes(r.meetingLeadMin)) {
    out.meetingLeadMin = r.meetingLeadMin;
  }
  if (typeof r.dropFolder === 'string' && (r.dropFolder === '' || path.isAbsolute(r.dropFolder))) out.dropFolder = r.dropFolder;
  if (typeof r.deviceAlerts === 'boolean') out.deviceAlerts = r.deviceAlerts;
  if (typeof r.taskNudges === 'boolean') out.taskNudges = r.taskNudges;
  for (const key of ['quietInMeetings', 'shortcuts', 'endOfDay', 'weeklySummary', 'lateNight', 'eyeBreaks', 'costumes'] as const) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  }
  if (typeof r.endOfDayTime === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(r.endOfDayTime.trim())) out.endOfDayTime = r.endOfDayTime.trim();
  if (typeof r.weatherCity === 'string') out.weatherCity = r.weatherCity.replace(/\s+/g, ' ').trim().slice(0, 80);
  const place = r.weatherPlace as Record<string, unknown> | null | undefined;
  if (place && typeof place.name === 'string' && typeof place.lat === 'number' && typeof place.lon === 'number') {
    out.weatherPlace = { name: place.name.slice(0, 120), lat: place.lat, lon: place.lon };
  }
  if (COATS.some(([id]) => id === r.coat)) out.coat = r.coat as Coat;
  if (r.style === '2d' || r.style === '3d' || r.style === 'photo') out.style = r.style;
  if (typeof r.waterGoal === 'number' && (WATER_GOALS as readonly number[]).includes(r.waterGoal)) out.waterGoal = r.waterGoal;
  if (r.ambient === 'off' || r.ambient === 'rain' || r.ambient === 'waves' || r.ambient === 'brown') out.ambient = r.ambient;
  if (typeof r.ambientFocusOnly === 'boolean') out.ambientFocusOnly = r.ambientFocusOnly;
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
