import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TaskNudger, TaskStore } from '../src/main/tasks';

const at = (d: number, h: number, m = 0): number => new Date(2026, 0, d, h, m).getTime();

test('agrega, marca, borra y guarda', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pet-tasks-')), 'tasks.json');
  const tasks = new TaskStore(file);
  const a = tasks.add('  Enviar   informe ', at(10, 9))!;
  const b = tasks.add('Llamar a Ana', at(10, 9))!;
  assert.equal(tasks.add('   ', at(10, 9)), null);
  assert.equal(a.text, 'Enviar informe');
  assert.equal(tasks.toggle(a.id, at(10, 10)), true);
  assert.deepEqual(tasks.list.map((t) => t.text), ['Llamar a Ana', 'Enviar informe'], 'pendientes primero');
  tasks.remove(b.id);
  assert.deepEqual(new TaskStore(file).list.map((t) => [t.text, t.done]), [['Enviar informe', true]]);
  assert.equal(tasks.toggle('nada', at(10, 10)), null);
});

test('al cambiar de día se van las hechas; las pendientes siguen', () => {
  const tasks = new TaskStore();
  const a = tasks.add('a', at(10, 9))!;
  tasks.add('b', at(10, 9));
  tasks.toggle(a.id, at(10, 11));
  tasks.rollover(at(10, 18));
  assert.equal(tasks.list.length, 2, 'mismo día: se quedan');
  tasks.rollover(at(11, 8));
  assert.deepEqual(tasks.list.map((t) => t.text), ['b']);
});

test('recordatorio de tareas: al llegar en el día y después cada 2 horas', () => {
  const n = new TaskNudger(120);
  const base = { pending: 2, enabled: true, away: false, quiet: false };
  assert.equal(n.tick({ ...base, now: at(10, 8), away: true }), null, 'no estás');
  assert.equal(n.tick({ ...base, now: at(10, 9) }), 'morning');
  assert.equal(n.tick({ ...base, now: at(10, 10) }), null);
  assert.equal(n.tick({ ...base, now: at(10, 11) }), 'reminder');
  n.postpone(at(10, 12));
  assert.equal(n.tick({ ...base, now: at(10, 13) }), null, 'pospuesto');
  assert.equal(n.tick({ ...base, now: at(10, 14) }), 'reminder');
  assert.equal(n.tick({ ...base, now: at(10, 17), pending: 0 }), null);
  assert.equal(n.tick({ ...base, now: at(11, 9) }), 'morning', 'día nuevo');
  assert.equal(n.tick({ ...base, now: at(12, 9), pending: 0 }), null, 'sin pendientes no hay saludo');
});
