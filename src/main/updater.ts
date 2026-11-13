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
const MAX_BYTES = 20 * 1024 * 1024;

/** Contenido de latest.json. */
export interface UpdateInfo {
  build: number;
  shell: number;
  sha256: string;
  url: string;
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
  return { build: r.build, shell: r.shell, sha256: r.sha256, url: r.url };
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

  const dir = `build-${info.build}`;
  const target = path.join(root, dir);
  fs.rmSync(target, { recursive: true, force: true });
  for (const [rel, data] of Object.entries(bundle.files)) {
    const file = path.resolve(target, rel);
    // Nada de escribir fuera de la carpeta de la actualización.
    if (!file.startsWith(target + path.sep)) throw new Error(`Ruta no permitida: ${rel}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  const current: CurrentUpdate = { build: info.build, shell: info.shell, dir };
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify(current));

  // Limpia versiones anteriores.
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith('build-') && name !== dir) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return current;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * Consulta si hay una versión nueva y, si la hay, la deja lista.
 * Devuelve el número de compilación instalado, o null si no había nada nuevo.
 */
export async function checkForUpdate(root: string, currentBuild: number, fetcher: Fetcher): Promise<number | null> {
  const feed = await fetcher(FEED_URL);
  if (!feed.ok) throw new Error(`No se pudo consultar la versión (${feed.status})`);
  const info = parseUpdateInfo(JSON.parse(Buffer.from(await feed.arrayBuffer()).toString('utf8')));
  if (!info || !isNewer(info, currentBuild)) return null;

  const res = await fetcher(info.url);
  if (!res.ok) throw new Error(`No se pudo descargar la actualización (${res.status})`);
  fs.mkdirSync(root, { recursive: true });
  return installBundle(root, info, new Uint8Array(await res.arrayBuffer())).build;
}
