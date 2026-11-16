import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSouthern, outfitFor } from '../src/shared/season';

test('disfraz según la fecha y el hemisferio', () => {
  const d = (m: number, day: number): Date => new Date(2026, m - 1, day);
  assert.equal(outfitFor(d(12, 1), true), 'santa');
  assert.equal(outfitFor(d(1, 5), false), 'santa');
  assert.equal(outfitFor(d(10, 31), true), 'witch');
  assert.equal(outfitFor(d(7, 10), true), 'scarf', 'julio en Chile');
  assert.equal(outfitFor(d(7, 10), false), null, 'julio en el norte');
  assert.equal(outfitFor(d(2, 10), false), 'scarf');
  assert.equal(outfitFor(d(4, 10), true), null);
  assert.equal(isSouthern('America/Santiago'), true);
  assert.equal(isSouthern('America/Mexico_City'), false);
  assert.equal(isSouthern('Europe/Madrid', -33), true, 'la latitud manda');
});
