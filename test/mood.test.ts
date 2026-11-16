import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Mood, foodLabel, joyLabel } from '../src/main/mood';

test('baja con el tiempo (más lento mientras no estás) y sube con cariño y comida', () => {
  const mood = new Mood();
  mood.state = { joy: 50, food: 50 };
  mood.decay(60 * 60_000, false);
  assert.equal(Math.round(mood.state.joy), 38);
  assert.equal(Math.round(mood.state.food), 40);
  mood.decay(60 * 60_000, true);
  assert.equal(Math.round(mood.state.joy), 35);
  mood.apply('treat');
  assert.equal(Math.round(mood.state.food), 68);
  for (let i = 0; i < 30; i++) mood.apply('play');
  assert.equal(mood.state.joy, 100, 'tope');
  mood.decay(100 * 3600_000, false);
  assert.deepEqual(mood.state, { joy: 0, food: 0 }, 'piso');
  assert.equal(mood.hungry, true);
});

test('etiquetas y persistencia', () => {
  assert.equal(joyLabel(80), 'Feliz');
  assert.equal(joyLabel(10), 'Triste');
  assert.equal(foodLabel(70), 'Satisfecho');
  assert.equal(foodLabel(10), 'Hambriento');
  const file = join(mkdtempSync(join(tmpdir(), 'pet-mood-')), 'mood.json');
  const mood = new Mood(file);
  mood.state = { joy: 12.34, food: 56.78 };
  mood.apply('pet');
  mood.save();
  assert.deepEqual(new Mood(file).state, { joy: 18.3, food: 56.8 });
});
