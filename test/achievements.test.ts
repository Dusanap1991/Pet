import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Achievements } from '../src/main/achievements';

test('se desbloquean una sola vez y se guardan', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pet-ach-')), 'a.json');
  const a = new Achievements(file);
  assert.deepEqual(a.bump('pets').map((x) => x.id), ['first-pet']);
  assert.deepEqual(a.bump('pets'), []);
  assert.deepEqual(a.update({ streak: 7, named: true }).map((x) => x.id), ['named', 'streak-3', 'streak-7']);
  for (let i = 0; i < 9; i++) a.bump('tasks');
  assert.deepEqual(a.bump('tasks').map((x) => x.id), ['tasks-10']);

  const again = new Achievements(file);
  const view = again.list();
  assert.equal(view.find((x) => x.id === 'tasks-10')?.unlocked, true);
  assert.equal(view.find((x) => x.id === 'tasks-100')?.progress, 10);
  assert.deepEqual(again.bump('pets'), [], 'ya estaba desbloqueado');
});
