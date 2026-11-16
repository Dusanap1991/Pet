import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pomodoro } from '../src/main/pomodoro';

const MIN = 60_000;

test('foco, descanso, y descanso largo tras el cuarto foco', () => {
  const p = new Pomodoro();
  assert.deepEqual(p.start(0), { phase: 'focus', round: 1, minutes: 25 });
  assert.equal(p.inFocus, true);
  assert.equal(p.tick(24 * MIN), null);
  const phases: string[] = [];
  let now = 0;
  for (let i = 0; i < 9; i++) {
    const step = p.current!;
    now += step.minutes * MIN;
    const r = p.tick(now)!;
    phases.push(`${r.next.phase}${r.next.round}`);
  }
  assert.deepEqual(phases, ['break1', 'focus2', 'break2', 'focus3', 'break3', 'focus4', 'long-break4', 'focus1', 'break1']);
});

test('no se va corriendo si el reloj revisa tarde; detener', () => {
  const p = new Pomodoro();
  p.start(0);
  p.tick(25 * MIN + 30_000);
  assert.equal(p.remainingMin(25 * MIN + 30_000), 5, 'el descanso termina a los 30, no a los 30:30');
  assert.equal(p.stop(), true);
  assert.equal(p.active, false);
  assert.equal(p.tick(99 * MIN), null);
});
