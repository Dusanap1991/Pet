import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { StatsStore } from '../src/main/stats';

const day = (d: number, h = 12): number => new Date(2026, 0, d, h).getTime();

test('suma por día y guarda en disco', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pet-stats-')), 'stats.json');
  const stats = new StatsStore(file);
  stats.addActive(day(10), 120);
  stats.add(day(10), 'water');
  stats.add(day(10), 'water');
  stats.add(day(11), 'focusSessions');
  stats.save();
  const again = new StatsStore(file);
  assert.equal(again.today(day(10)).activeSec, 120);
  assert.equal(again.today(day(10)).water, 2);
  assert.equal(again.today(day(11)).focusSessions, 1);
  assert.equal(again.today(day(12)).water, 0);
});

test('historial de 7 días, del más antiguo a hoy, con ceros donde no hay datos', () => {
  const stats = new StatsStore();
  stats.addActive(day(10), 60);
  const h = stats.history(day(12), 7);
  assert.equal(h.length, 7);
  assert.equal(h[6].day, '2026-01-12');
  assert.equal(h[4].day, '2026-01-10');
  assert.equal(h[4].stats.activeSec, 60);
  assert.equal(h[0].day, '2026-01-06');
});

test('racha: días seguidos con al menos 15 minutos; hoy no la corta mientras no llegue', () => {
  const stats = new StatsStore();
  for (const d of [5, 7, 8, 9]) stats.addActive(day(d), 20 * 60);
  stats.addActive(day(10), 5 * 60);
  assert.equal(stats.streak(day(10)), 3, '7, 8 y 9 (hoy 10 todavía no cuenta)');
  stats.addActive(day(10), 15 * 60);
  assert.equal(stats.streak(day(10)), 4);
  assert.equal(stats.streak(day(12)), 0, 'faltó el 11');
});

test('un día que cruza fin de mes', () => {
  const stats = new StatsStore();
  stats.addActive(new Date(2026, 0, 31, 12).getTime(), 20 * 60);
  stats.addActive(new Date(2026, 1, 1, 12).getTime(), 20 * 60);
  assert.equal(stats.streak(new Date(2026, 1, 1, 18).getTime()), 2);
});
