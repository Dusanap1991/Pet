import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { PetBridge, PetEvent } from '../shared/types';

const bridge: PetBridge = {
  onEvent(cb) {
    ipcRenderer.on('pet:event', (_event, payload: PetEvent) => cb(payload));
  },
  setInteractive(on) {
    ipcRenderer.send('pet:set-interactive', on === true);
  },
  setDragging(on) {
    ipcRenderer.send('pet:dragging', on === true);
  },
  showMenu() {
    ipcRenderer.send('pet:menu');
  },
  report(kind) {
    ipcRenderer.send('pet:report', kind);
  },
  battery(level, charging) {
    ipcRenderer.send('pet:battery', Number(level), charging === true);
  },
  ready() {
    ipcRenderer.send('pet:ready');
  },
};

contextBridge.exposeInMainWorld('pet', bridge);

// Archivos soltados sobre el perro: la ruta solo se puede leer aquí, no desde la página.
// (La ventana solo recibe el arrastre cuando el cursor está sobre el perro.)
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer?.files ?? []);
  const paths = files.map((f) => webUtils.getPathForFile(f)).filter((p) => p);
  if (paths.length > 0) ipcRenderer.send('pet:drop', paths);
});
