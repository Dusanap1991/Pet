import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WaterReminder } from '../src/main/water';

const MIN = 60_000;
const base = { enabled: true, everyMin: 45, away: false, quiet: false };

test('avisa cada intervalo contando desde el arranque', () => {
  const water = new WaterReminder(0, 45);
  assert.equal(water.minutesLeft(0), 45);
  assert.equal(water.tick({ ...base, now: 44 * MIN }), false);
  assert.equal(water.tick({ ...base, now: 45 * MIN }), true);
  assert.equal(water.tick({ ...base, now: 45 * MIN + 1000 }), false, 'no repite enseguida');
  assert.equal(water.tick({ ...base, now: 90 * MIN }), true);
});

test('si no hay nadie o es mal momento, espera y avisa apenas se pueda', () => {
  const water = new WaterReminder(0, 45);
  assert.equal(water.tick({ ...base, now: 50 * MIN, away: true }), false);
  assert.equal(water.tick({ ...base, now: 55 * MIN, quiet: true }), false);
  assert.equal(water.tick({ ...base, now: 56 * MIN }), true);
  assert.equal(water.tick({ ...base, now: 100 * MIN }), false, 'el siguiente cuenta desde el aviso');
  assert.equal(water.tick({ ...base, now: 101 * MIN }), true);
});

test('apagado no avisa ni acumula; cambiar el intervalo reinicia la cuenta', () => {
  const water = new WaterReminder(0, 45);
  assert.equal(water.tick({ ...base, now: 60 * MIN, enabled: false }), false);
  assert.equal(water.tick({ ...base, now: 61 * MIN }), false, 'recién encendido');
  assert.equal(water.tick({ ...base, now: 105 * MIN }), true);
  assert.equal(water.tick({ ...base, now: 106 * MIN, everyMin: 30 }), false);
  assert.equal(water.tick({ ...base, now: 135 * MIN, everyMin: 30 }), false);
  assert.equal(water.tick({ ...base, now: 136 * MIN, everyMin: 30 }), true);
});

test('postpone evita pisar otro mensaje', () => {
  const water = new WaterReminder(0, 45);
  water.postpone(44.9 * MIN, MIN);
  assert.equal(water.tick({ ...base, now: 45 * MIN }), false);
  assert.equal(water.tick({ ...base, now: 46 * MIN }), true);
});
