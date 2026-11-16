/**
 * Reuniones a partir de la dirección iCal de tu calendario (Outlook o Google la
 * ofrecen como "dirección secreta" o "publicar calendario"). Solo lectura.
 */
import ICAL from 'ical.js';

export interface Meeting {
  uid: string;
  title: string;
  start: number;
  end: number;
}

/** Acepta https:// y webcal:// (que es https con otro nombre). */
export function normalizeCalendarUrl(raw: string): string | null {
  const url = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Eventos con hora (no los de día completo) que empiezan entre `from` y `to`. */
export function parseCalendar(ics: string, from: number, to: number): Meeting[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const id = String(tz.getFirstPropertyValue('tzid') ?? '');
    if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
  }

  const out: Meeting[] = [];
  const fromTime = ICAL.Time.fromJSDate(new Date(from), true);
  for (const vevent of root.getAllSubcomponents('vevent')) {
    // Las excepciones de una serie se procesan junto con su evento principal.
    if (vevent.hasProperty('recurrence-id')) continue;
    if (String(vevent.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') continue;
    let event: InstanceType<typeof ICAL.Event>;
    try {
      event = new ICAL.Event(vevent);
    } catch {
      continue;
    }
    if (!event.startDate || event.startDate.isDate) continue;

    const push = (start: InstanceType<typeof ICAL.Time>, end: InstanceType<typeof ICAL.Time>, title: string): void => {
      const s = start.toJSDate().getTime();
      if (s >= from && s < to) out.push({ uid: event.uid, title: title || 'Reunión', start: s, end: end.toJSDate().getTime() });
    };

    if (!event.isRecurring()) {
      push(event.startDate, event.endDate, event.summary);
      continue;
    }
    const it = event.iterator();
    for (let i = 0; i < 2000; i++) {
      const next = it.next();
      if (!next) break;
      const details = event.getOccurrenceDetails(next);
      const start = details.startDate.toJSDate().getTime();
      if (start >= to) break;
      if (start < fromTime.toJSDate().getTime()) continue;
      const item = details.item;
      if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') continue;
      push(details.startDate, details.endDate, item.summary);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** La reunión en curso, si hay (para dejar los avisos en pausa). */
export function currentMeeting(meetings: Meeting[], now: number): Meeting | null {
  return meetings.find((m) => m.start <= now && now < m.end) ?? null;
}

/** Decide cuándo avisar de cada reunión (una sola vez por reunión). */
export class MeetingAlerts {
  private sent = new Set<string>();

  tick(now: number, meetings: Meeting[], leadMin: number): Meeting[] {
    const due = meetings.filter((m) => {
      const key = `${m.uid}@${m.start}`;
      // Desde `leadMin` antes hasta un minuto después de empezar (por si el equipo estaba suspendido).
      if (this.sent.has(key) || now < m.start - leadMin * 60_000 || now > m.start + 60_000) return false;
      this.sent.add(key);
      return true;
    });
    // Olvida las ya pasadas.
    if (this.sent.size > 500) this.sent = new Set([...this.sent].slice(-200));
    return due;
  }
}
