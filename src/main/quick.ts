/**
 * Nota rápida (con el atajo de teclado): lo que escribes se vuelve una tarea o,
 * si empieza con un "cuándo", un recordatorio.
 *   "Enviar informe"            → tarea
 *   "en 20 min llamar a Ana"    → recordatorio en 20 minutos
 *   "en 1 hora sacar la ropa"   → recordatorio en 60 minutos
 *   "a las 16:30 remedio"       → recordatorio a esa hora (hoy, o mañana si ya pasó)
 */
import { calc, looksLikeMath } from './calc';
import { nextOccurrence } from './reminders';

export type QuickNote =
  | { kind: 'task'; text: string }
  | { kind: 'reminder'; text: string; at: number }
  | { kind: 'calc'; text: string; result: number };

const IN = /^en\s+(\d{1,4})\s*(m|min|mins|minuto|minutos|h|hr|hrs|hora|horas)\b[\s,:.-]*(.+)$/i;
const AT = /^a\s+las?\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:h|hrs)?\b[\s,:.-]*(.+)$/i;

export function parseQuick(raw: string, now: number): QuickNote | null {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!text) return null;

  if (looksLikeMath(text)) {
    const result = calc(text);
    if (result !== null) return { kind: 'calc', text: text.replace(/^=\s*/, ''), result };
  }

  const inMatch = IN.exec(text);
  if (inMatch) {
    const n = Number(inMatch[1]);
    const minutes = /^h/i.test(inMatch[2]) ? n * 60 : n;
    if (minutes >= 1 && minutes <= 24 * 60) return { kind: 'reminder', text: inMatch[3].trim(), at: now + minutes * 60_000 };
  }

  const atMatch = AT.exec(text);
  if (atMatch) {
    const h = Number(atMatch[1]);
    const m = Number(atMatch[2] ?? 0);
    if (h <= 23 && m <= 59) return { kind: 'reminder', text: atMatch[3].trim(), at: nextOccurrence(h, m, now) };
  }

  return { kind: 'task', text };
}
