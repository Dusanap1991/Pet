import { contextBridge, ipcRenderer } from 'electron';
import type { ReminderRequest } from '../main/reminders';

contextBridge.exposeInMainWorld('reminderForm', {
  add(request: ReminderRequest): void {
    ipcRenderer.send('reminder:add', request);
  },
  close(): void {
    ipcRenderer.send('reminder:close');
  },
});
