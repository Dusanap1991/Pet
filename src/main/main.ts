import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  screen,
  Tray,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type Display,
  type Rectangle,
} from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PetEvent, PetSize } from '../shared/types';
import { ActivityTracker } from './activity';
import { FocusSession } from './focus';
import { checkForUpdate } from './updater';
import { BREAK_CHOICES, loadSettings, saveSettings, type Settings } from './settings';

declare const __PET_BUILD__: number;

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const FOCUS_CHOICES = [15, 25, 45];
const SIZES: [PetSize, string][] = [['s', 'Chico'], ['m', 'Mediano'], ['l', 'Grande']];
/** Cada cuánto se mira dónde está el cursor para saber si está sobre el perro. */
const CURSOR_POLL_MS = 33;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: Settings;
let settingsFile = '';
let rendererReady = false;
let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
let lastCursorX = NaN;
let lastCursorY = NaN;
let lastFocusMin = -1;
let dragging = false;
/** Compilación ya descargada que se aplicará al reiniciar. */
let updateReady: number | null = null;
let checkingUpdate = false;
let cursorTimer: NodeJS.Timeout | undefined;
let activityTimer: NodeJS.Timeout | undefined;

const tracker = new ActivityTracker();
const focus = new FocusSession();

// ------------------------------------------------------------- ventana

function send(event: PetEvent): void {
  if (win && !win.isDestroyed() && rendererReady) win.webContents.send('pet:event', event);
}

function isFromPet(event: IpcMainEvent): boolean {
  return win !== null && !win.isDestroyed() && event.sender === win.webContents;
}

/**
 * Una ventana transparente del tamaño del área de trabajo de la pantalla
 * principal. Deja pasar todos los clics salvo cuando el cursor está sobre el
 * perro (lo decide la ventana y avisa con `pet:set-interactive`).
 */
/** La pantalla donde vive el perro; si ya no está conectada, la principal. */
function currentDisplay(): Display {
  const saved = screen.getAllDisplays().find((d) => d.id === settings.displayId);
  return saved ?? screen.getPrimaryDisplay();
}

function moveToDisplay(display: Display): void {
  if (!win || win.isDestroyed()) return;
  settings = { ...settings, displayId: display.id };
  saveSettings(settingsFile, settings);
  bounds = display.workArea;
  // Dos veces: entre pantallas con distinta escala la primera puede quedar con el tamaño equivocado.
  win.setBounds(bounds);
  win.setBounds(bounds);
  lastCursorX = NaN;
  refreshTray();
}

function createWindow(): void {
  bounds = currentDisplay().workArea;
  rendererReady = false;

  win = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // No roba el foco de la app en la que estás trabajando.
    focusable: false,
    acceptFirstMouse: true,
    alwaysOnTop: true,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.once('ready-to-show', () => {
    win?.showInactive();
    // El perro llegó a mostrarse: la actualización en uso queda confirmada como sana.
    fs.rmSync(path.join(updateRoot(), 'pending'), { force: true });
  });
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });

  void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function fitToDisplay(): void {
  if (!win || win.isDestroyed()) return;
  bounds = currentDisplay().workArea;
  win.setBounds(bounds);
  refreshTray();
}

function showPet(): void {
  if (!win || win.isDestroyed()) return;
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
}

function toggleVisible(): void {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else showPet();
  refreshTray();
}

// ------------------------------------------------------ actualizaciones

function updateRoot(): string {
  return path.join(app.getPath('userData'), 'update');
}

/** Busca una versión nueva en GitHub y la deja lista para el próximo arranque. */
async function lookForUpdate(manual: boolean): Promise<void> {
  if (!app.isPackaged || checkingUpdate) return;
  checkingUpdate = true;
  try {
    const build = await checkForUpdate(updateRoot(), updateReady ?? __PET_BUILD__, (url) => net.fetch(url, { cache: 'no-store' }));
    if (build !== null) {
      updateReady = build;
      send({ type: 'notice', text: '¡Hay una versión nueva! Reinicia desde mi menú para estrenarla.' });
    } else if (manual) {
      send({ type: 'notice', text: updateReady ? 'La versión nueva ya está lista: reinicia desde mi menú.' : 'Ya tienes la última versión.' });
    }
  } catch (err) {
    console.error('No se pudo buscar actualizaciones:', err);
    if (manual) send({ type: 'notice', text: 'No pude buscar actualizaciones. ¿Hay internet?' });
  } finally {
    checkingUpdate = false;
    refreshTray();
  }
}

function restartToUpdate(): void {
  app.relaunch();
  app.quit();
}

function updateMenu(): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: `Versión ${app.getVersion()} (compilación ${__PET_BUILD__})`, enabled: false },
  ];
  if (updateReady) items.push({ label: `Reiniciar para actualizar (compilación ${updateReady})`, click: restartToUpdate });
  else if (app.isPackaged) items.push({ label: 'Buscar actualizaciones', click: () => void lookForUpdate(true) });
  return items;
}

// ------------------------------------------------------------- bandeja

function trayImage(): Electron.NativeImage {
  const file = path.join(__dirname, '../assets', isMac ? 'trayTemplate.png' : 'tray.png');
  const image = nativeImage.createFromPath(file);
  if (isMac) image.setTemplateImage(true);
  return image;
}

function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  saveSettings(settingsFile, settings);
  if (patch.size) send({ type: 'settings', size: settings.size });
  refreshTray();
}

function startFocus(minutes: number): void {
  focus.start(Date.now(), minutes);
  lastFocusMin = -1;
  showPet();
  send({ type: 'focus-start', minutes });
  refreshTray();
}

function cancelFocus(): void {
  if (focus.cancel()) send({ type: 'focus-end', completed: false, minutes: focus.minutes });
  refreshTray();
}

/** Con más de una pantalla, permite elegir en cuál vive (también se lo puede arrastrar de una a otra). */
function displayMenu(): MenuItemConstructorOptions[] {
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return [];
  const current = currentDisplay().id;
  const primary = screen.getPrimaryDisplay().id;
  return [{
    label: 'Pantalla',
    submenu: displays.map((d, i) => ({
      label: `Pantalla ${i + 1}${d.id === primary ? ' (principal)' : ''}, ${d.size.width}×${d.size.height}`,
      type: 'radio' as const,
      checked: d.id === current,
      click: () => moveToDisplay(d),
    })),
  }];
}

function buildMenu(): Menu {
  const shown = win !== null && !win.isDestroyed() && win.isVisible();
  const template: MenuItemConstructorOptions[] = [
    { label: shown ? 'Ocultar al perro' : 'Mostrar al perro', click: toggleVisible },
    { type: 'separator' },
    { label: 'Dar un premio', enabled: shown, click: () => send({ type: 'treat' }) },
    focus.active
      ? { label: `Cancelar foco (quedan ${focus.remainingMin(Date.now())} min)`, click: cancelFocus }
      : {
          label: 'Sesión de foco',
          submenu: FOCUS_CHOICES.map((m) => ({ label: `${m} minutos`, click: () => startFocus(m) })),
        },
    { type: 'separator' },
    {
      label: 'Avisarme de descansos',
      type: 'checkbox',
      checked: settings.breakReminders,
      click: (item) => updateSettings({ breakReminders: item.checked }),
    },
    {
      label: 'Avisar cada',
      enabled: settings.breakReminders,
      submenu: BREAK_CHOICES.map((m) => ({
        label: `${m} minutos`,
        type: 'radio' as const,
        checked: settings.breakEveryMin === m,
        click: () => updateSettings({ breakEveryMin: m }),
      })),
    },
    {
      label: 'Tamaño',
      submenu: SIZES.map(([id, label]) => ({
        label,
        type: 'radio' as const,
        checked: settings.size === id,
        click: () => updateSettings({ size: id }),
      })),
    },
    ...displayMenu(),
    {
      label: 'Abrir al iniciar sesión',
      type: 'checkbox',
      // Solo tiene sentido con la app instalada, no en desarrollo.
      enabled: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    ...updateMenu(),
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(focus.active ? `Pet: foco, quedan ${focus.remainingMin(Date.now())} min` : 'Pet');
}

function createTray(): void {
  tray = new Tray(trayImage());
  if (isWin) tray.on('click', () => tray?.popUpContextMenu());
  refreshTray();
}

// ------------------------------------------------------------ relojes

function pollCursor(): void {
  if (!win || win.isDestroyed() || !rendererReady || !win.isVisible()) return;
  const point = screen.getCursorScreenPoint();
  if (dragging) {
    // Lo llevan agarrado hacia otra pantalla: la ventana se muda con él.
    const under = screen.getDisplayNearestPoint(point);
    if (under.id !== currentDisplay().id) moveToDisplay(under);
  }
  const x = point.x - bounds.x;
  const y = point.y - bounds.y;
  if (x === lastCursorX && y === lastCursorY) return;
  lastCursorX = x;
  lastCursorY = y;
  send({ type: 'cursor', x, y });
}

function tickActivity(): void {
  const now = Date.now();
  let idleSec = 0;
  try {
    idleSec = powerMonitor.getSystemIdleTime();
  } catch {
    // Sin dato de inactividad: se asume que hay alguien.
  }

  const events = tracker.tick({
    now,
    idleSec,
    breaksEnabled: settings.breakReminders && !focus.active,
    breakEveryMin: settings.breakEveryMin,
  });
  for (const event of events) send(event);

  if (focus.tick(now)) {
    // Si estaba oculto, aparece: pediste que te avisara.
    showPet();
    send({ type: 'focus-end', completed: true, minutes: focus.minutes });
    tracker.snooze(now);
    refreshTray();
  } else if (focus.active) {
    const left = focus.remainingMin(now);
    if (left !== lastFocusMin) {
      lastFocusMin = left;
      refreshTray();
    }
  }
}

// ---------------------------------------------------------------- app

function start(): void {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  settings = loadSettings(settingsFile);

  if (isWin) app.setAppUserModelId('com.dusanap1991.pet');
  if (isMac) app.dock?.hide();

  ipcMain.on('pet:ready', (event) => {
    if (!isFromPet(event)) return;
    rendererReady = true;
    send({ type: 'settings', size: settings.size });
    if (tracker.isAway) send({ type: 'away' });
    if (focus.active) send({ type: 'focus-start', minutes: focus.minutes });
  });

  ipcMain.on('pet:set-interactive', (event, on: unknown) => {
    if (!isFromPet(event)) return;
    win?.setIgnoreMouseEvents(on !== true);
  });

  ipcMain.on('pet:dragging', (event, on: unknown) => {
    if (!isFromPet(event)) return;
    dragging = on === true;
  });

  createWindow();
  createTray();

  screen.on('display-metrics-changed', fitToDisplay);
  screen.on('display-added', fitToDisplay);
  screen.on('display-removed', fitToDisplay);

  const goAway = (): void => {
    for (const event of tracker.forceAway(Date.now())) send(event);
  };
  powerMonitor.on('lock-screen', goAway);
  powerMonitor.on('suspend', goAway);

  cursorTimer = setInterval(pollCursor, CURSOR_POLL_MS);
  activityTimer = setInterval(tickActivity, 1000);

  setTimeout(() => void lookForUpdate(false), 15_000);
  setInterval(() => void lookForUpdate(false), UPDATE_CHECK_MS);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showPet();
    refreshTray();
  });

  // La app vive en la bandeja: no se cierra aunque no haya ventanas.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    clearInterval(cursorTimer);
    clearInterval(activityTimer);
  });

  void app.whenReady().then(start);
}
