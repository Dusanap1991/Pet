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
