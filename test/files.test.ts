import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanPaths, moveFiles } from '../src/main/files';

test('mueve archivos y carpetas, sin pisar nombres repetidos', () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-files-'));
  const dest = join(root, 'destino');
  mkdirSync(dest);
  writeFileSync(join(dest, 'informe.pdf'), 'viejo');
  writeFileSync(join(root, 'informe.pdf'), 'nuevo');
  mkdirSync(join(root, 'fotos'));
  writeFileSync(join(root, 'fotos', 'a.jpg'), 'x');

  const r = moveFiles([join(root, 'informe.pdf'), join(root, 'fotos')], dest);
  assert.deepEqual(r, { moved: 2, skipped: [] });
  assert.equal(readFileSync(join(dest, 'informe.pdf'), 'utf8'), 'viejo');
  assert.equal(readFileSync(join(dest, 'informe (2).pdf'), 'utf8'), 'nuevo');
  assert.equal(existsSync(join(dest, 'fotos', 'a.jpg')), true);
});

test('no mueve la carpeta destino dentro de sí misma ni lo que ya está ahí', () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-files-'));
  const dest = join(root, 'destino');
  mkdirSync(dest);
  writeFileSync(join(dest, 'ya.txt'), 'x');
  const r = moveFiles([root, join(dest, 'ya.txt')], dest);
  assert.equal(r.moved, 0);
  assert.equal(r.skipped.length, 2);
  assert.throws(() => moveFiles([], join(root, 'no-existe')), /no existe/);
});

test('cleanPaths solo deja rutas absolutas que existen', () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-files-'));
  writeFileSync(join(root, 'a.txt'), 'x');
  assert.deepEqual(cleanPaths([join(root, 'a.txt'), join(root, 'a.txt'), 'relativo.txt', join(root, 'no.txt'), 4]), [join(root, 'a.txt')]);
  assert.deepEqual(cleanPaths('x'), []);
});
