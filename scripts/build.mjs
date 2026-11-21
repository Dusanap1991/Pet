// Compila el proceso principal, el preload y la ventana a dist/ con esbuild.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';

const dev = process.argv.includes('--dev');
// Número de compilación (lo pone CI); 0 en desarrollo.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const define = {
  __PET_BUILD__: String(Number(process.env.PET_BUILD) || 0),
  __PET_VERSION__: JSON.stringify(pkg.version),
};
const common = { bundle: true, sourcemap: dev, logLevel: 'warning', legalComments: 'none', define };

await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });
await mkdir('dist/reminder', { recursive: true });
await mkdir('dist/panel', { recursive: true });

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    // Más chico arranca antes; los nombres se conservan para que los errores se entiendan.
    minify: !dev,
    keepNames: true,
  }),
  build({
    ...common,
    entryPoints: ['src/main/boot.ts'],
    outfile: 'dist/main/boot.js',
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
    // Módulos con división en partes: el motor 3D (three.js) y las siluetas de los
    // videos quedan en archivos propios, que se cargan solo cuando hacen falta y
    // casi nunca cambian (así las actualizaciones bajan menos).
    entryPoints: { renderer: 'src/renderer/main.ts' },
    outdir: 'dist/renderer',
    entryNames: '[name]',
    chunkNames: 'parte-[hash]',
    splitting: true,
    platform: 'browser',
    target: 'chrome130',
    format: 'esm',
    minify: !dev,
  }),
  build({
    ...common,
    entryPoints: ['src/preload/reminder.ts'],
    outfile: 'dist/preload/reminder.js',
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/reminder/main.ts'],
    outfile: 'dist/reminder/reminder.js',
    platform: 'browser',
    target: 'chrome130',
    format: 'iife',
    minify: !dev,
  }),
  build({
    ...common,
    entryPoints: ['src/preload/panel.ts'],
    outfile: 'dist/preload/panel.js',
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: { day: 'src/panel/day.ts', settings: 'src/panel/settings.ts', quick: 'src/panel/quick.ts', notes: 'src/panel/notes.ts' },
    outdir: 'dist/panel',
    platform: 'browser',
    target: 'chrome130',
    format: 'iife',
    minify: !dev,
  }),
  ...['day.html', 'settings.html', 'quick.html', 'notes.html', 'panel.css', 'day.css', 'settings.css'].map((f) => cp(`src/panel/${f}`, `dist/panel/${f}`)),
  cp('src/reminder/index.html', 'dist/reminder/index.html'),
  cp('src/reminder/style.css', 'dist/reminder/style.css'),
  cp('src/renderer/index.html', 'dist/renderer/index.html'),
  cp('src/renderer/style.css', 'dist/renderer/style.css'),
  cp('assets', 'dist/assets', { recursive: true }),
]);

console.log('Build listo en dist/');
