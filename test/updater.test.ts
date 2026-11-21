import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FEED_URL, RELEASES_URL, SHELL_VERSION, checkForUpdate, installBundle, parseUpdateInfo, sha256,
  type Fetcher, type UpdateInfo,
} from '../src/main/updater';

const b64 = (s: string): string => Buffer.from(s).toString('base64');

function makeBundle(build: number, files: Record<string, string>, shell = SHELL_VERSION): { bytes: Uint8Array; info: UpdateInfo } {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify({ build, shell, files })));
  return { bytes, info: { build, shell, sha256: sha256(bytes), url: `${RELEASES_URL}/download/build-${build}/update.json` } };
}

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pet-upd-'));

test('instala el paquete y limpia versiones anteriores', () => {
  const root = tmp();
  mkdirSync(join(root, 'build-3'));
  const { bytes, info } = makeBundle(7, { 'main/main.js': b64('console.log(7)'), 'renderer/index.html': b64('<p>') });
  const cur = installBundle(root, info, bytes);
  assert.deepEqual(cur, { build: 7, shell: SHELL_VERSION, dir: 'build-7' });
  assert.equal(readFileSync(join(root, 'build-7/main/main.js'), 'utf8'), 'console.log(7)');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')), cur);
  assert.equal(existsSync(join(root, 'build-3')), false);
});

test('rechaza un paquete alterado, incompleto o que escribe fuera de su carpeta', () => {
  const root = tmp();
  const good = makeBundle(7, { 'main/main.js': b64('x') });
  assert.throws(() => installBundle(root, { ...good.info, sha256: '0'.repeat(64) }, good.bytes), /huella/);
  const noMain = makeBundle(7, { 'renderer/index.html': b64('x') });
  assert.throws(() => installBundle(root, noMain.info, noMain.bytes), /main/);
  const evil = makeBundle(7, { 'main/main.js': b64('x'), '../../fuera.js': b64('x') });
  assert.throws(() => installBundle(root, evil.info, evil.bytes), /Ruta no permitida/);
  assert.equal(existsSync(join(root, 'current.json')), false);
});

test('solo acepta anuncios bien formados que apunten a las releases del repo', () => {
  const { info } = makeBundle(7, { 'main/main.js': b64('x') });
  assert.deepEqual(parseUpdateInfo(info), info);
  assert.equal(parseUpdateInfo({ ...info, url: 'https://example.com/update.json' }), null);
  assert.equal(parseUpdateInfo({ ...info, sha256: 'abc' }), null);
  assert.equal(parseUpdateInfo({ ...info, build: 0 }), null);
  assert.equal(parseUpdateInfo(null), null);
});

function fakeFetch(info: UpdateInfo, bytes: Uint8Array, calls: string[]): Fetcher {
  return async (url) => {
    calls.push(url);
    const body = url === FEED_URL ? new Uint8Array(Buffer.from(JSON.stringify(info))) : bytes;
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer };
  };
}

test('descarga solo si la compilación publicada es más nueva y compatible', async () => {
  const { bytes, info } = makeBundle(12, { 'main/main.js': b64('x') });

  let calls: string[] = [];
  assert.equal(await checkForUpdate(tmp(), 12, fakeFetch(info, bytes, calls)), null);
  assert.deepEqual(calls, [FEED_URL], 'misma compilación: no descarga');

  calls = [];
  const root = tmp();
  assert.equal(await checkForUpdate(root, 10, fakeFetch(info, bytes, calls)), 12);
  assert.deepEqual(calls, [FEED_URL, info.url]);
  assert.equal(existsSync(join(root, 'build-12/main/main.js')), true);

  const other = makeBundle(12, { 'main/main.js': b64('x') }, SHELL_VERSION + 1);
  calls = [];
  assert.equal(await checkForUpdate(tmp(), 10, fakeFetch(other.info, other.bytes, calls)), null);
  assert.deepEqual(calls, [FEED_URL], 'otra versión de la app base: hay que reinstalar');
});

/** Anuncio con la huella de cada archivo (actualización por partes). */
function makeParts(build: number, files: Record<string, string>): { info: UpdateInfo; bytes: Uint8Array; blobs: Map<string, Buffer> } {
  const { bytes, info } = makeBundle(build, Object.fromEntries(Object.entries(files).map(([k, v]) => [k, b64(v)])));
  const blobs = new Map<string, Buffer>();
  info.files = {};
  for (const [rel, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    info.files[rel] = sha256(data);
    blobs.set(sha256(data), data);
  }
  return { info, bytes, blobs };
}

function partsFetch(p: { info: UpdateInfo; bytes: Uint8Array; blobs: Map<string, Buffer> }, calls: string[], broken = new Set<string>()): Fetcher {
  const base = p.info.url.replace(/[^/]+$/, '');
  return async (url) => {
    calls.push(url);
    let body: Uint8Array;
    if (url === FEED_URL) body = Buffer.from(JSON.stringify(p.info));
    else if (url === p.info.url) body = p.bytes;
    else {
      const hash = url.slice(base.length).replace(/\.bin$/, '');
      const blob = p.blobs.get(hash);
      if (!blob) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      body = broken.has(hash) ? Buffer.from('alterado') : blob;
    }
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer };
  };
}

test('por partes: baja solo lo que cambió y copia el resto de lo instalado', async () => {
  const installed = tmp();
  mkdirSync(join(installed, 'main'));
  mkdirSync(join(installed, 'assets'));
  writeFileSync(join(installed, 'main/main.js'), 'viejo');
  writeFileSync(join(installed, 'assets/perro.webm'), 'video pesado');

  const p = makeParts(20, { 'main/main.js': 'nuevo', 'assets/perro.webm': 'video pesado' });
  const calls: string[] = [];
  const root = tmp();
  assert.equal(await checkForUpdate(root, 10, partsFetch(p, calls), [installed]), 20);
  assert.deepEqual(calls, [FEED_URL, `${p.info.url.replace(/[^/]+$/, '')}${sha256(Buffer.from('nuevo'))}.bin`], 'solo baja main.js');
  assert.equal(readFileSync(join(root, 'build-20/main/main.js'), 'utf8'), 'nuevo');
  assert.equal(readFileSync(join(root, 'build-20/assets/perro.webm'), 'utf8'), 'video pesado');
});

test('por partes: la siguiente versión reutiliza la actualización anterior y la limpia', async () => {
  const root = tmp();
  const first = makeParts(20, { 'main/main.js': 'a', 'renderer/parte.js': 'b' });
  await checkForUpdate(root, 10, partsFetch(first, []), []);
  const second = makeParts(21, { 'main/main.js': 'c', 'renderer/parte.js': 'b' });
  const calls: string[] = [];
  assert.equal(await checkForUpdate(root, 20, partsFetch(second, calls), [join(root, 'build-20')]), 21);
  assert.equal(calls.length, 2, 'el anuncio y main.js');
  assert.equal(readFileSync(join(root, 'build-21/renderer/parte.js'), 'utf8'), 'b');
  assert.equal(existsSync(join(root, 'build-20')), false);
});

test('por partes: si un archivo llega alterado o falta, usa el paquete completo', async () => {
  const p = makeParts(22, { 'main/main.js': 'x', 'renderer/r.js': 'y' });
  const calls: string[] = [];
  const root = tmp();
  assert.equal(await checkForUpdate(root, 10, partsFetch(p, calls, new Set([sha256(Buffer.from('y'))])), []), 22);
  assert.equal(calls[calls.length - 1], p.info.url, 'terminó bajando update.json');
  assert.equal(readFileSync(join(root, 'build-22/renderer/r.js'), 'utf8'), 'y');
});

test('por partes: una lista de archivos con rutas raras se ignora', () => {
  const { info } = makeParts(23, { 'main/main.js': 'x' });
  assert.ok(parseUpdateInfo(info)?.files);
  for (const bad of ['../fuera.js', '/abs.js', 'a//b.js', 'a/./b.js', 'a\\b.js']) {
    const parsed = parseUpdateInfo({ ...info, files: { ...info.files, [bad]: '0'.repeat(64) } });
    assert.ok(parsed, 'el anuncio sigue sirviendo');
    assert.equal(parsed.files, undefined, `ignora ${bad}`);
  }
  assert.equal(parseUpdateInfo({ ...info, files: { 'renderer/r.js': '0'.repeat(64) } })?.files, undefined, 'sin main.js');
});
