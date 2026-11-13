import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  Tray,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
} from 'electron';
import * as path from 'node:path';
import type { PetEvent, PetSize } from '../shared/types';
import { ActivityTracker } from './activity';
import { FocusSession } from './focus';
import { BREAK_CHOICES, loadSettings, saveSettings, type Settings } from './settings';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const FOCUS_CHOICES = [15, 25, 45];
const SIZES: [PetSize, string][] = [['s', 'Chico'], ['m', 'Mediano'], ['l', 'Grande']];
/** Cada cuánto se mira dónde está el cursor para saber si está sobre el perro. */
const CURSOR_POLL_MS = 33;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: Settings;
let settingsFile = '';
let rendererReady = false;
let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
let lastCursorX = NaN;
let lastCursorY = NaN;
let lastFocusMin = -1;
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
function createWindow(): void {
  bounds = screen.getPrimaryDisplay().workArea;
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

  win.once('ready-to-show', () => win?.showInactive());
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });

  void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function fitToDisplay(): void {
  if (!win || win.isDestroyed()) return;
  bounds = screen.getPrimaryDisplay().workArea;
  win.setBounds(bounds);
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
    {
      label: 'Abrir al iniciar sesión',
      type: 'checkbox',
      // Solo tiene sentido con la app instalada, no en desarrollo.
      enabled: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
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
