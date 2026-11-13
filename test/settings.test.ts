import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings } from '../src/main/settings';

test('descarta valores inválidos y conserva los válidos', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('x'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ size: 'xl', breakReminders: 'si', breakEveryMin: 9999 }), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ size: 'l', breakReminders: false, breakEveryMin: 30, waterEveryMin: 60 }), {
    ...DEFAULT_SETTINGS,
    size: 'l',
    breakReminders: false,
    breakEveryMin: 30,
    waterEveryMin: 60,
  });
});

test('guarda y vuelve a leer; un archivo inexistente da los valores por defecto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pet-'));
  const file = join(dir, 'nested', 'settings.json');
  assert.deepEqual(loadSettings(file), DEFAULT_SETTINGS);
  const saved = { ...DEFAULT_SETTINGS, size: 's' as const, breakEveryMin: 90, waterReminders: false };
  saveSettings(file, saved);
  assert.deepEqual(loadSettings(file), saved);
});
