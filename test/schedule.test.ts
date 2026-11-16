import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DailyTrigger, FRIDAY, WEEKDAYS, parseHHMM } from '../src/main/schedule';

// 2026-01-16 es viernes.
const at = (d: number, h: number, m = 0): number => new Date(2026, 0, d, h, m).getTime();
const base = { h: 18, m: 0, enabled: true, ready: true };

test('parseHHMM', () => {
  assert.deepEqual(parseHHMM('18:30'), { h: 18, m: 30 });
  assert.deepEqual(parseHHMM('7:05'), { h: 7, m: 5 });
  assert.equal(parseHHMM('24:00'), null);
  assert.equal(parseHHMM('18'), null);
});

test('una vez al día, dentro de la ventana, y espera si no estás listo', () => {
  const t = new DailyTrigger(120, WEEKDAYS);
  assert.equal(t.tick({ ...base, now: at(15, 17, 59) }), false);
  assert.equal(t.tick({ ...base, now: at(15, 18, 5), ready: false }), false, 'en reunión');
  assert.equal(t.tick({ ...base, now: at(15, 18, 40) }), true);
  assert.equal(t.tick({ ...base, now: at(15, 18, 41) }), false, 'ya avisó hoy');
  assert.equal(t.tick({ ...base, now: at(16, 21, 0) }), false, 'demasiado tarde');
  assert.equal(t.tick({ ...base, now: at(17, 18, 0) }), false, 'sábado');
  assert.equal(t.tick({ ...base, now: at(19, 18, 0), enabled: false }), false);
  assert.equal(t.tick({ ...base, now: at(19, 18, 0) }), true, 'lunes');
});

test('solo viernes', () => {
  const t = new DailyTrigger(180, FRIDAY);
  assert.equal(t.tick({ ...base, h: 16, now: at(15, 16, 30) }), false);
  assert.equal(t.tick({ ...base, h: 16, now: at(16, 16, 30) }), true);
});
