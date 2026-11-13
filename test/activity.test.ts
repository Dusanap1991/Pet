import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActivityTracker, type ActivityEvent } from '../src/main/activity';

const MIN = 60_000;

/** Avanza el reloj de a un segundo, con el usuario activo o quieto, y junta los eventos. */
function run(
  tracker: ActivityTracker,
  from: number,
  seconds: number,
  active: boolean,
  opts: { breaksEnabled?: boolean; breakEveryMin?: number; idleStart?: number } = {},
): { events: ActivityEvent[]; now: number } {
  const events: ActivityEvent[] = [];
  let now = from;
  for (let i = 1; i <= seconds; i++) {
    now = from + i * 1000;
    events.push(
      ...tracker.tick({
        now,
        idleSec: active ? 0 : (opts.idleStart ?? 0) + i,
        breaksEnabled: opts.breaksEnabled ?? true,
        breakEveryMin: opts.breakEveryMin ?? 50,
      }),
    );
  }
  return { events, now };
}

test('se va a dormir tras dos minutos sin input y avisa al volver', () => {
  const tracker = new ActivityTracker();
  let { events, now } = run(tracker, 0, 30, true);
  assert.deepEqual(events, []);

  ({ events, now } = run(tracker, now, 119, false));
  assert.deepEqual(events, [], 'todavía no pasan los dos minutos');

  ({ events, now } = run(tracker, now, 481, false, { idleStart: 119 }));
  assert.deepEqual(events, [{ type: 'away' }]);
  assert.equal(tracker.isAway, true);

  ({ events } = run(tracker, now, 3, true));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'back');
  // 600 s quieto + el segundo en que vuelve.
  assert.equal((events[0] as { awaySec: number }).awaySec, 601);
  assert.equal(tracker.isAway, false);
});

test('avisa de descanso tras el tramo configurado y repite cada 10 minutos', () => {
  const tracker = new ActivityTracker();
  const { events } = run(tracker, 0, 62 * 60, true, { breakEveryMin: 50 });
  const due = events.filter((e) => e.type === 'break-due');
  assert.equal(due.length, 2);
  assert.deepEqual(due[0], { type: 'break-due', minutes: 50 });
  assert.deepEqual(due[1], { type: 'break-due', minutes: 60 });
});

test('una pausa de cinco minutos reinicia el tramo de trabajo', () => {
  const tracker = new ActivityTracker();
  let { events, now } = run(tracker, 0, 40 * 60, true);
  assert.equal(events.filter((e) => e.type === 'break-due').length, 0);

  ({ now } = run(tracker, now, 6 * 60, false));
  ({ events } = run(tracker, now, 45 * 60, true));
  assert.equal(events.filter((e) => e.type === 'break-due').length, 0, 'el tramo empezó de nuevo');
});

test('una pausa corta no reinicia el tramo', () => {
  const tracker = new ActivityTracker();
  let { now } = run(tracker, 0, 40 * 60, true);
  ({ now } = run(tracker, now, 3 * 60, false));
  const { events } = run(tracker, now, 8 * 60, true);
  assert.equal(events.filter((e) => e.type === 'break-due').length, 1);
});

test('no avisa de descansos si están desactivados', () => {
  const tracker = new ActivityTracker();
  const { events } = run(tracker, 0, 70 * 60, true, { breaksEnabled: false });
  assert.deepEqual(events, []);
});

test('snooze pospone el siguiente aviso', () => {
  const tracker = new ActivityTracker();
  let { events, now } = run(tracker, 0, 49 * 60, true);
  assert.deepEqual(events, []);
  tracker.snooze(now);
  ({ events, now } = run(tracker, now, 5 * 60, true));
  assert.deepEqual(events, [], 'recién pospuesto');
  ({ events } = run(tracker, now, 6 * 60, true));
  assert.equal(events.filter((e) => e.type === 'break-due').length, 1);
});

test('al bloquear la pantalla queda ausente y solo vuelve con un input nuevo', () => {
  const tracker = new ActivityTracker();
  let { now } = run(tracker, 0, 10, true);
  assert.deepEqual(tracker.forceAway(now), [{ type: 'away' }]);
  assert.deepEqual(tracker.forceAway(now), [], 'no repite el aviso');

  // El último input es anterior al bloqueo: sigue ausente.
  let events = tracker.tick({ now: now + 1000, idleSec: 1, breaksEnabled: true, breakEveryMin: 50 });
  assert.deepEqual(events, []);

  now += 30_000;
  events = tracker.tick({ now, idleSec: 0, breaksEnabled: true, breakEveryMin: 50 });
  assert.deepEqual(events, [{ type: 'back', awaySec: 30 }]);
});

test('un salto de reloj (equipo suspendido) cuenta como ausencia y como descanso', () => {
  const tracker = new ActivityTracker();
  let { now } = run(tracker, 0, 45 * 60, true);

  now += 20 * MIN;
  let events = tracker.tick({ now, idleSec: 20 * 60, breaksEnabled: true, breakEveryMin: 50 });
  assert.deepEqual(events, [{ type: 'away' }]);

  const after = run(tracker, now, 10 * 60, true);
  assert.equal(after.events[0].type, 'back');
  assert.equal(after.events.filter((e) => e.type === 'break-due').length, 0, 'la suspensión reinició el tramo');
});
