// Arma el paquete de actualización (update.json) y su anuncio (latest.json) a partir de dist/.
// Uso: PET_BUILD=12 node scripts/make-update.mjs [carpeta de salida]
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const build = Number(process.env.PET_BUILD);
if (!Number.isInteger(build) || build <= 0) throw new Error('Falta PET_BUILD (número de compilación)');
const SHELL_VERSION = Number(/SHELL_VERSION = (\d+)/.exec(readFileSync('src/main/updater.ts', 'utf8'))[1]);
const out = process.argv[2] || 'release-update';

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else {
      const rel = relative('dist', file).split(sep).join('/');
      // boot.js es el arranque fijo de la app instalada; no viaja en la actualización.
      if (rel !== 'main/boot.js' && !rel.endsWith('.map')) files[rel] = readFileSync(file).toString('base64');
    }
  }
};
walk('dist');

mkdirSync(out, { recursive: true });
const bundle = Buffer.from(JSON.stringify({ build, shell: SHELL_VERSION, files }));
writeFileSync(join(out, 'update.json'), bundle);
writeFileSync(
  join(out, 'latest.json'),
  JSON.stringify({
    build,
    shell: SHELL_VERSION,
    sha256: createHash('sha256').update(bundle).digest('hex'),
    url: `https://github.com/Dusanap1991/Pet/releases/download/build-${build}/update.json`,
  }),
);
console.log(`Actualización ${build}: ${Object.keys(files).length} archivos, ${bundle.length} bytes`);
