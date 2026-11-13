// Regenera build/icon.png y los íconos de bandeja en assets/ a partir del dibujo del perro.
// Herramienta de desarrollo: necesita Playwright con Chromium instalado en la máquina
// (no es dependencia del proyecto). Uso: node scripts/make-icons.mjs
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const bundle = await build({
  entryPoints: ['scripts/icons/entry.ts'],
  bundle: true,
  format: 'iife',
  write: false,
  logLevel: 'warning',
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const icons = await page.evaluate(() => window.__icons);
await browser.close();

for (const [file, dataUrl] of Object.entries(icons)) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('escrito', file);
}
