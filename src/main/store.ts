/** Lectura y escritura de archivos JSON en la carpeta de datos de la app. */
import * as fs from 'node:fs';
import * as path from 'node:path';

export function readJson(file: string | undefined): unknown {
  if (!file) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Escribe primero a un archivo temporal y lo renombra: si algo falla, el anterior queda intacto. */
export function writeJson(file: string | undefined, data: unknown): void {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`No se pudo guardar ${path.basename(file)}:`, err);
  }
}

/** Fecha local "AAAA-MM-DD". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** El día local anterior a `key`. */
export function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
}
