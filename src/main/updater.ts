/**
 * Actualizaciones sin reinstalar: la app baja de GitHub un paquete con el
 * código nuevo (lo que hay en dist/) y lo usa en el siguiente arranque.
 * No reemplaza la app instalada, así que funciona aunque no esté firmada.
 *
 * Este archivo no depende de Electron para poder probarlo.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Sube solo si cambia algo que el paquete no puede actualizar (Electron o boot.ts). */
export const SHELL_VERSION = 1;

export const RELEASES_URL = 'https://github.com/Dusanap1991/Pet/releases';
export const FEED_URL = `${RELEASES_URL}/latest/download/latest.json`;
// Con los videos del perro el paquete ronda los 10 MB; se deja margen para más clips.
const MAX_BYTES = 60 * 1024 * 1024;

/** Contenido de latest.json. */
export interface UpdateInfo {
  build: number;
  shell: number;
  sha256: string;
  url: string;
  /**
   * Ruta relativa → huella sha256 de cada archivo de la versión. Con esto se bajan
   * solo los archivos que cambiaron (publicados como `<huella>.bin` junto a
   * update.json); el resto se copia de lo que ya está instalado.
   */
  files?: Record<string, string>;
}

/** Contenido de update.json. */
export interface UpdateBundle {
  build: number;
  shell: number;
  /** Ruta relativa → contenido en base64. */
  files: Record<string, string>;
}

/** Lo que boot.ts lee para decidir qué código cargar. */
export interface CurrentUpdate {
  build: number;
  shell: number;
  dir: string;
}

export function parseUpdateInfo(raw: unknown): UpdateInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.build !== 'number' || !Number.isInteger(r.build) || r.build <= 0) return null;
  if (typeof r.shell !== 'number') return null;
  if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) return null;
  if (typeof r.url !== 'string' || !r.url.startsWith(`${RELEASES_URL}/download/`)) return null;
  const info: UpdateInfo = { build: r.build, shell: r.shell, sha256: r.sha256, url: r.url };
  const files = parseFileList(r.files);
  if (files) info.files = files;
  return info;
}

const HASH = /^[0-9a-f]{64}$/;

/** La lista de archivos es opcional: si viene mal, se usa el paquete completo. */
function parseFileList(raw: unknown): Record<string, string> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const out: Record<string, string> = {};
  for (const [rel, hash] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof hash !== 'string' || !HASH.test(hash)) return null;
    if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((p) => p === '' || p === '.' || p === '..')) return null;
    out[rel] = hash;
  }
  return out['main/main.js'] ? out : null;
}

/** ¿Vale la pena bajar esta versión? */
export function isNewer(info: UpdateInfo, currentBuild: number): boolean {
  return info.shell === SHELL_VERSION && info.build > currentBuild;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Verifica el paquete y lo deja instalado en `root` para el próximo arranque.
 * Lanza un error si el contenido no coincide con lo anunciado.
 */
export function installBundle(root: string, info: UpdateInfo, bytes: Uint8Array): CurrentUpdate {
  if (bytes.byteLength > MAX_BYTES) throw new Error('El paquete es demasiado grande');
  if (sha256(bytes) !== info.sha256) throw new Error('El paquete no coincide con su huella');

  const bundle = JSON.parse(Buffer.from(bytes).toString('utf8')) as UpdateBundle;
  if (bundle.build !== info.build || bundle.shell !== info.shell) throw new Error('El paquete no es la versión anunciada');
  if (typeof bundle.files !== 'object' || bundle.files === null) throw new Error('Paquete sin archivos');
  if (typeof bundle.files['main/main.js'] !== 'string') throw new Error('Paquete sin main/main.js');

  const files = new Map<string, Buffer>();
  for (const [rel, data] of Object.entries(bundle.files)) files.set(rel, Buffer.from(data, 'base64'));
  return writeVersion(root, info, files);
}

/** Deja la versión en `root/build-N`, la marca como la actual y borra las anteriores. */
function writeVersion(root: string, info: UpdateInfo, files: Map<string, Buffer>): CurrentUpdate {
  const dir = `build-${info.build}`;
  const target = path.join(root, dir);
  for (const rel of files.keys()) {
    // Nada de escribir fuera de la carpeta de la actualización.
    if (!path.resolve(target, rel).startsWith(target + path.sep)) throw new Error(`Ruta no permitida: ${rel}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  for (const [rel, data] of files) {
    const file = path.resolve(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }

  const current: CurrentUpdate = { build: info.build, shell: info.shell, dir };
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify(current));

  // Limpia versiones anteriores.
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith('build-') && name !== dir) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return current;
}

/** Todos los archivos de estas carpetas, por su huella (para reutilizar lo que no cambió). */
function indexLocal(dirs: string[]): Map<string, string> {
  const byHash = new Map<string, string>();
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).isDirectory()) walk(file);
        else byHash.set(sha256(fs.readFileSync(file)), file);
      } catch {
        // Archivo ilegible: se baja de nuevo.
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return byHash;
}

/**
 * Arma la versión nueva copiando los archivos que ya están en `localDirs` y
 * bajando solo los que cambiaron. Cada archivo se verifica con su huella.
 */
async function installFromFiles(root: string, info: UpdateInfo, files: Record<string, string>, localDirs: string[], fetcher: Fetcher): Promise<CurrentUpdate> {
  const local = indexLocal(localDirs);
  const base = info.url.replace(/[^/]+$/, '');
  const got = new Map<string, Buffer>();
  const missing = [...new Set(Object.values(files))].filter((h) => !local.has(h));
  let total = 0;
  // De a 4 descargas a la vez.
  const queue = [...missing];
  const worker = async (): Promise<void> => {
    for (let hash = queue.shift(); hash; hash = queue.shift()) {
      const res = await fetcher(`${base}${hash}.bin`);
      if (!res.ok) throw new Error(`No se pudo descargar un archivo de la actualización (${res.status})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      total += bytes.byteLength;
      if (total > MAX_BYTES) throw new Error('La actualización es demasiado grande');
      if (sha256(bytes) !== hash) throw new Error('Un archivo no coincide con su huella');
      got.set(hash, bytes);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const out = new Map<string, Buffer>();
  for (const [rel, hash] of Object.entries(files)) {
    const bytes = got.get(hash) ?? fs.readFileSync(local.get(hash)!);
    // Se vuelve a verificar: el archivo local pudo cambiar mientras se bajaba el resto.
    if (sha256(bytes) !== hash) throw new Error(`Archivo local alterado: ${rel}`);
    out.set(rel, bytes);
  }
  return writeVersion(root, info, out);
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * Consulta si hay una versión nueva y, si la hay, la deja lista.
 * `localDirs` son las carpetas con el código que ya está en el equipo (el
 * instalado y la última actualización): de ahí se toma lo que no cambió.
 * Devuelve el número de compilación instalado, o null si no había nada nuevo.
 */
export async function checkForUpdate(root: string, currentBuild: number, fetcher: Fetcher, localDirs: string[] = []): Promise<number | null> {
  const feed = await fetcher(FEED_URL);
  if (!feed.ok) throw new Error(`No se pudo consultar la versión (${feed.status})`);
  const info = parseUpdateInfo(JSON.parse(Buffer.from(await feed.arrayBuffer()).toString('utf8')));
  if (!info || !isNewer(info, currentBuild)) return null;
  fs.mkdirSync(root, { recursive: true });

  if (info.files) {
    try {
      return (await installFromFiles(root, info, info.files, localDirs, fetcher)).build;
    } catch (err) {
      // Si algo falla, se intenta con el paquete completo.
      console.warn('Actualización por partes falló; se baja completa:', err);
    }
  }

  const res = await fetcher(info.url);
  if (!res.ok) throw new Error(`No se pudo descargar la actualización (${res.status})`);
  return installBundle(root, info, new Uint8Array(await res.arrayBuffer())).build;
}
