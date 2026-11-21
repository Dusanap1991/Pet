import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ReminderStore, nextOccurrence, parseRequest } from '../src/main/reminders';

const at = (h: number, m: number, day = 15): number => new Date(2026, 0, day, h, m, 0, 0).getTime();

test('nextOccurrence: hoy si falta, mañana si ya pasó', () => {
  assert.equal(nextOccurrence(16, 0, at(10, 0)), at(16, 0));
  assert.equal(nextOccurrence(9, 30, at(10, 0)), at(9, 30, 16));
  assert.equal(nextOccurrence(10, 0, at(10, 0)), at(10, 0, 16), 'la hora exacta ya pasó');
});

test('parseRequest valida el formulario', () => {
  const now = at(10, 0);
  assert.deepEqual(parseRequest({ text: '  Llamar   a Ana ', mode: 'in', minutes: 20 }, now), { text: 'Llamar a Ana', at: now + 20 * 60_000 });
  assert.deepEqual(parseRequest({ text: 'Remedio', mode: 'at', time: '16:05', daily: true }, now), {
    text: 'Remedio', at: at(16, 5), daily: { h: 16, m: 5 },
  });
  assert.deepEqual(parseRequest({ text: 'x', mode: 'at', time: '9:00' }, now), { text: 'x', at: at(9, 0, 16) });
  assert.equal(parseRequest({ text: '   ', mode: 'in', minutes: 5 }, now), null);
  assert.equal(parseRequest({ text: 'x', mode: 'in', minutes: 0 }, now), null);
  assert.equal(parseRequest({ text: 'x', mode: 'at', time: '25:00' }, now), null);
  assert.equal(parseRequest({ text: 'x', mode: 'otro' }, now), null);
  assert.equal(parseRequest('x', now), null);
  assert.equal(parseRequest({ text: 'a'.repeat(500), mode: 'in', minutes: 1 }, now)?.text.length, 120);
});

test('entrega los que ya tocan: los de una vez se van, los diarios pasan a mañana', () => {
  const store = new ReminderStore();
  store.add({ text: 'una vez', at: at(10, 5) });
  store.add({ text: 'diario', at: at(10, 10), daily: { h: 10, m: 10 } });
  store.add({ text: 'después', at: at(18, 0) });

  assert.deepEqual(store.takeDue(at(10, 0)), []);
  assert.deepEqual(store.takeDue(at(10, 12)).map((r) => r.text), ['una vez', 'diario']);
  assert.deepEqual(store.list.map((r) => [r.text, r.at]), [['después', at(18, 0)], ['diario', at(10, 10, 16)]]);
  assert.deepEqual(store.takeDue(at(10, 13)), [], 'no repite');
});

test('se guardan en disco, se pueden borrar y un archivo dañado no rompe nada', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pet-rem-')), 'sub', 'reminders.json');
  const store = new ReminderStore(file);
  const a = store.add({ text: 'a', at: at(12, 0) });
  store.add({ text: 'b', at: at(11, 0) });
  assert.ok(a);
  assert.deepEqual(new ReminderStore(file).list.map((r) => r.text), ['b', 'a']);
  store.remove(a.id);
  assert.deepEqual(new ReminderStore(file).list.map((r) => r.text), ['b']);
  assert.deepEqual(new ReminderStore(join(tmpdir(), 'no-existe-pet.json')).list, []);
});

import { nextRepeat, repeatLabel } from '../src/main/reminders';

// 2026-01-16 es viernes.
const t = (mo: number, d: number, h: number, m = 0, y = 2026): number => new Date(y, mo - 1, d, h, m).getTime();

test('repeticiones: lunes a viernes, un día de la semana y cada año', () => {
  assert.equal(nextRepeat({ kind: 'weekdays', h: 9, m: 0 }, t(1, 16, 8)), t(1, 16, 9), 'viernes antes de la hora');
  assert.equal(nextRepeat({ kind: 'weekdays', h: 9, m: 0 }, t(1, 16, 10)), t(1, 19, 9), 'salta el fin de semana');
  assert.equal(nextRepeat({ kind: 'weekly', h: 18, m: 30, day: 3 }, t(1, 16, 10)), t(1, 21, 18, 30), 'próximo miércoles');
  assert.equal(nextRepeat({ kind: 'yearly', h: 9, m: 0, month: 3, date: 5 }, t(1, 16, 10)), t(3, 5, 9));
  assert.equal(nextRepeat({ kind: 'yearly', h: 9, m: 0, month: 1, date: 2 }, t(1, 16, 10)), t(1, 2, 9, 0, 2027));
  assert.equal(nextRepeat({ kind: 'yearly', h: 9, m: 0, month: 2, date: 29 }, t(3, 1, 10)), t(2, 28, 9, 0, 2027), '29 de febrero en año no bisiesto');
});

test('el formulario acepta repetir y fechas; la tienda vuelve a programarlos', () => {
  const now = t(1, 16, 10);
  const weekly = parseRequest({ text: 'Basura', mode: 'at', time: '20:00', repeat: 'weekly', weekday: 2 }, now)!;
  assert.equal(weekly.at, t(1, 20, 20));
  assert.equal(repeatLabel({ id: 'x', ...weekly }), 'martes');
  const bday = parseRequest({ text: 'Cumpleaños de Ana', mode: 'date', date: '2026-01-10', time: '09:00', yearly: true }, now)!;
  assert.equal(bday.at, t(1, 10, 9, 0, 2027), 'ya pasó este año: el próximo');
  assert.equal(parseRequest({ text: 'x', mode: 'date', date: '2026-01-10', time: '09:00' }, now), null, 'una sola vez en el pasado');
  assert.equal(parseRequest({ text: 'x', mode: 'date', date: '2026-02-31', time: '09:00' }, now), null, 'fecha inválida');
  assert.equal(parseRequest({ text: 'x', mode: 'at', time: '09:00', repeat: 'weekly', weekday: 9 }, now), null);

  const store = new ReminderStore();
  store.add(weekly);
  assert.equal(store.takeDue(t(1, 20, 20, 1)).length, 1);
  assert.equal(store.list[0].at, t(1, 27, 20), 'una semana después');
});
