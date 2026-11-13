// Compila el proceso principal, el preload y la ventana a dist/ con esbuild.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const dev = process.argv.includes('--dev');
const common = { bundle: true, sourcemap: dev, logLevel: 'warning', legalComments: 'none' };

await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload/preload.js',
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/main.ts'],
    outfile: 'dist/renderer/renderer.js',
    platform: 'browser',
    target: 'chrome130',
    format: 'iife',
    minify: !dev,
  }),
  cp('src/renderer/index.html', 'dist/renderer/index.html'),
  cp('src/renderer/style.css', 'dist/renderer/style.css'),
  cp('assets', 'dist/assets', { recursive: true }),
]);

console.log('Build listo en dist/');
