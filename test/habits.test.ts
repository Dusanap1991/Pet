import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HabitStore } from '../src/main/habits';
import { TaskNudger } from '../src/main/tasks';

const day = (d: number): number => new Date(2026, 0, d, 12).getTime();

test('hábitos: marcar, desmarcar, racha y guardar', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pet-hab-')), 'h.json');
  const habits = new HabitStore(file);
  const h = habits.add('  Ejercicio  ', day(1))!;
  assert.equal(h.name, 'Ejercicio');
  assert.equal(habits.add('', day(1)), null);
  for (const d of [3, 4, 5]) habits.toggle(h.id, day(d));
  assert.equal(habits.streak(h, day(5)), 3);
  assert.equal(habits.streak(h, day(6)), 3, 'hoy todavía no: la racha sigue desde ayer');
  assert.equal(habits.streak(h, day(7)), 0);
  assert.equal(habits.toggle(h.id, day(5)), false, 'desmarcar hoy');
  assert.equal(habits.streak(h, day(5)), 2);
  const again = new HabitStore(file);
  assert.deepEqual(again.list[0].done, ['2026-01-03', '2026-01-04']);
  again.remove(h.id);
  assert.equal(new HabitStore(file).list.length, 0);
});

test('si ya anotaste algo hoy, no hay saludo de la mañana encima', () => {
  const n = new TaskNudger(120);
  const now = new Date(2026, 0, 10, 9).getTime();
  n.markGreeted(now);
  assert.equal(n.tick({ now: now + 5000, pending: 1, enabled: true, away: false, quiet: false }), null);
});
