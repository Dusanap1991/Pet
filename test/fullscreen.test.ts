import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFullscreen, parseWindows } from '../src/main/fullscreen';

// MacBook con notch: la barra de menú mide 38 y el Dock 70.
const display = { x: 0, y: 0, width: 1512, height: 982 };
const workArea = { x: 0, y: 38, width: 1512, height: 874 };
const menuBar = '24,0,0,1512,38';

test('parseWindows ignora basura', () => {
  assert.deepEqual(parseWindows('0,0,38,1512,944;24,0,0,1512,38'), [
    { layer: 0, x: 0, y: 38, width: 1512, height: 944 },
    { layer: 24, x: 0, y: 0, width: 1512, height: 38 },
  ]);
  assert.deepEqual(parseWindows(''), []);
  assert.deepEqual(parseWindows('0,1,2;x,y,z,a,b'), []);
});

test('una app en pantalla completa: ocupa todo y no hay barra de menú', () => {
  assert.equal(isFullscreen(parseWindows('0,0,38,1512,944'), display, workArea), true, 'bajo el notch');
  assert.equal(isFullscreen(parseWindows('0,0,0,1512,982'), display, workArea), true, 'toda la pantalla');
});

test('ventanas normales o maximizadas no cuentan', () => {
  assert.equal(isFullscreen(parseWindows(`${menuBar};0,100,120,900,600`), display, workArea), false);
  assert.equal(isFullscreen(parseWindows(`${menuBar};0,0,38,1512,874`), display, workArea), false, 'maximizada sobre el Dock');
  assert.equal(isFullscreen(parseWindows(`${menuBar};0,0,38,1512,944`), display, workArea), false, 'Dock oculto pero barra de menú visible');
  assert.equal(isFullscreen(parseWindows('0,0,38,1512,874'), display, workArea), false, 'no llega hasta abajo');
  assert.equal(isFullscreen([], display, workArea), false);
});

test('solo cuenta la pantalla donde está el perro', () => {
  const second = { x: 1512, y: 0, width: 1920, height: 1080 };
  const secondWork = { x: 1512, y: 25, width: 1920, height: 1055 };
  const windows = parseWindows(`${menuBar};0,1512,0,1920,1080`);
  assert.equal(isFullscreen(windows, second, secondWork), true);
  assert.equal(isFullscreen(windows, display, workArea), false);
});
