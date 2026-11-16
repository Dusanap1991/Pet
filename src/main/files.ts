/** Mover archivos soltados sobre el perro a una carpeta. */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Valida la lista que llega de la ventana: rutas absolutas que existen, sin repetir. */
export function cleanPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw.slice(0, 100)) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    const resolved = path.resolve(p);
    if (!out.includes(resolved) && fs.existsSync(resolved)) out.push(resolved);
  }
  return out;
}

/** "informe.pdf" → "informe (2).pdf" si ya existe. */
export function freeName(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return path.join(dir, candidate);
}

export interface MoveResult {
  moved: number;
  skipped: string[];
}

export function moveFiles(paths: string[], dir: string): MoveResult {
  const target = path.resolve(dir);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error('La carpeta de destino no existe');
  const result: MoveResult = { moved: 0, skipped: [] };
  for (const src of paths) {
    const name = path.basename(src);
    // Ya está en esa carpeta, o es la carpeta misma (o una que la contiene).
    if (path.dirname(src) === target || target === src || target.startsWith(src + path.sep)) {
      result.skipped.push(name);
      continue;
    }
    const dest = freeName(target, name);
    try {
      fs.renameSync(src, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
        result.skipped.push(name);
        continue;
      }
      // Otro disco: copiar y después borrar el original.
      try {
        fs.cpSync(src, dest, { recursive: true, errorOnExist: true });
        fs.rmSync(src, { recursive: true });
      } catch {
        result.skipped.push(name);
        continue;
      }
    }
    result.moved++;
  }
  return result;
}
