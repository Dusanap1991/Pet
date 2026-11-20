/** Puente de las ventanas "Mi día" y "Ajustes": solo los canales que necesitan. */
import { contextBridge, ipcRenderer } from 'electron';

const INVOKE = new Set([
  'day:get', 'task:add', 'task:toggle', 'task:remove',
  'settings:get', 'settings:set', 'calendar:test', 'folder:choose', 'weather:test', 'quick:add',
  'habit:add', 'habit:toggle', 'habit:remove', 'mood:set',
]);
const EVENTS = new Set(['day:changed', 'settings:changed']);

contextBridge.exposeInMainWorld('petPanel', {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`Canal no permitido: ${channel}`));
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, cb: () => void): void {
    if (EVENTS.has(channel)) ipcRenderer.on(channel, () => cb());
  },
  close(): void {
    ipcRenderer.send('panel:close');
  },
});
