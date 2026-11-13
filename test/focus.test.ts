import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FocusSession } from '../src/main/focus';

test('termina una sola vez al cumplirse el tiempo', () => {
  const focus = new FocusSession();
  assert.equal(focus.active, false);
  focus.start(1000, 25);
  assert.equal(focus.active, true);
  assert.equal(focus.remainingMin(1000), 25);
  assert.equal(focus.remainingMin(1000 + 24.5 * 60_000), 1);
  assert.equal(focus.tick(1000 + 25 * 60_000 - 1), false);
  assert.equal(focus.tick(1000 + 25 * 60_000), true);
  assert.equal(focus.tick(1000 + 26 * 60_000), false);
  assert.equal(focus.active, false);
  assert.equal(focus.minutes, 25);
});

test('cancelar informa si había una sesión', () => {
  const focus = new FocusSession();
  assert.equal(focus.cancel(), false);
  focus.start(0, 15);
  assert.equal(focus.cancel(), true);
  assert.equal(focus.active, false);
  assert.equal(focus.remainingMin(0), 0);
});
