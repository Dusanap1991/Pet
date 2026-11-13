/**
 * Punto de entrada de la app instalada. Decide qué código cargar: el que vino
 * con el instalador o una actualización más nueva bajada a la carpeta de datos.
 * Este archivo no se actualiza solo; por eso es lo más chico posible.
 */
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SHELL_VERSION, type CurrentUpdate } from './updater';

declare const __PET_BUILD__: number;

const root = path.join(app.getPath('userData'), 'update');
const currentFile = path.join(root, 'current.json');
const pendingFile = path.join(root, 'pending');

function discard(): void {
  fs.rmSync(currentFile, { force: true });
  fs.rmSync(pendingFile, { force: true });
}

function pickUpdate(): string | null {
  if (!app.isPackaged) return null;
  try {
    const cur = JSON.parse(fs.readFileSync(currentFile, 'utf8')) as CurrentUpdate;
    if (cur.shell !== SHELL_VERSION || !(cur.build > __PET_BUILD__)) return null;
    // La marca sigue ahí: el arranque anterior con esta actualización no llegó a mostrar al perro.
    if (fs.existsSync(pendingFile)) {
      discard();
      return null;
    }
    const entry = path.join(root, path.basename(cur.dir), 'main', 'main.js');
    if (!fs.existsSync(entry)) return null;
    fs.writeFileSync(pendingFile, String(cur.build));
    return entry;
  } catch {
    return null;
  }
}

const load = (file: string): void => {
  require(file);
};

const update = pickUpdate();
if (update) {
  try {
    load(update);
  } catch (err) {
    console.error('La actualización falló al cargar; se vuelve a la versión instalada:', err);
    discard();
    app.relaunch();
    app.exit(0);
  }
} else {
  load(path.join(__dirname, 'main.js'));
}
