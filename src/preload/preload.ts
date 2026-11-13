import { contextBridge, ipcRenderer } from 'electron';
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
  ready() {
    ipcRenderer.send('pet:ready');
  },
};

contextBridge.exposeInMainWorld('pet', bridge);
