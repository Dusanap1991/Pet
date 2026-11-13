import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
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
