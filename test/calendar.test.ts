import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeetingAlerts, normalizeCalendarUrl, parseCalendar } from '../src/main/calendar';

// Recortado de lo que exporta Outlook: zona horaria con nombre de Windows, una serie semanal
// con una excepción movida y una fecha cancelada, un evento suelto y uno de día completo.
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN
BEGIN:VTIMEZONE
TZID:Pacific SA Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:-0300
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=4
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T000000
TZOFFSETFROM:-0400
TZOFFSETTO:-0300
RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=9
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:serie-1
SUMMARY:Reunión de equipo
DTSTART;TZID=Pacific SA Standard Time:20260105T100000
DTEND;TZID=Pacific SA Standard Time:20260105T103000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Pacific SA Standard Time:20260112T100000
END:VEVENT
BEGIN:VEVENT
UID:serie-1
RECURRENCE-ID;TZID=Pacific SA Standard Time:20260119T100000
SUMMARY:Reunión de equipo (movida)
DTSTART;TZID=Pacific SA Standard Time:20260119T150000
DTEND;TZID=Pacific SA Standard Time:20260119T153000
END:VEVENT
BEGIN:VEVENT
UID:suelto-1
SUMMARY:Dentista
DTSTART:20260113T140000Z
DTEND:20260113T150000Z
END:VEVENT
BEGIN:VEVENT
UID:dia-1
SUMMARY:Feriado
DTSTART;VALUE=DATE:20260114
DTEND;VALUE=DATE:20260115
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

const utc = (iso: string): number => new Date(iso).getTime();

test('expande series, respeta excepciones y fechas borradas, y omite los de día completo', () => {
  const meetings = parseCalendar(ICS, utc('2026-01-10T00:00:00Z'), utc('2026-01-27T00:00:00Z'));
  assert.deepEqual(
    meetings.map((m) => [m.title, new Date(m.start).toISOString()]),
    [
      ['Dentista', '2026-01-13T14:00:00.000Z'],
      // En enero en Chile (Pacific SA) rige el horario de verano: UTC-3.
      ['Reunión de equipo (movida)', '2026-01-19T18:00:00.000Z'],
      ['Reunión de equipo', '2026-01-26T13:00:00.000Z'],
    ],
  );
  assert.equal(meetings[2].end - meetings[2].start, 30 * 60_000);
});

test('avisa una sola vez, desde N minutos antes', () => {
  const alerts = new MeetingAlerts();
  const m = { uid: 'a', title: 'x', start: 10 * 60_000, end: 20 * 60_000 };
  assert.deepEqual(alerts.tick(4 * 60_000, [m], 5), []);
  assert.deepEqual(alerts.tick(5 * 60_000, [m], 5), [m]);
  assert.deepEqual(alerts.tick(6 * 60_000, [m], 5), []);
  assert.deepEqual(new MeetingAlerts().tick(12 * 60_000, [m], 5), [], 'ya empezó hace rato');
});

test('normaliza la dirección del calendario', () => {
  assert.equal(normalizeCalendarUrl(' webcal://outlook.office365.com/owa/calendar/x/reachcalendar.ics '), 'https://outlook.office365.com/owa/calendar/x/reachcalendar.ics');
  assert.equal(normalizeCalendarUrl('https://calendar.google.com/calendar/ical/x/basic.ics'), 'https://calendar.google.com/calendar/ical/x/basic.ics');
  assert.equal(normalizeCalendarUrl('http://inseguro.com/a.ics'), null);
  assert.equal(normalizeCalendarUrl('no es una url'), null);
  assert.equal(normalizeCalendarUrl(''), null);
});
