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
import { isFullscreen, watchWindows, type WindowRect } from './fullscreen';
import { ReminderStore, parseRequest } from './reminders';
import { checkForUpdate } from './updater';
import { WaterReminder } from './water';
import { BREAK_CHOICES, WATER_CHOICES, loadSettings, saveSettings, type Settings } from './settings';

declare const __PET_BUILD__: number;

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const FOCUS_CHOICES = [15, 25, 45];
const TIMER_CHOICES = [5, 10, 15, 20, 30, 45, 60];
const HIDE_CHOICES: [number, string][] = [[30, '30 minutos'], [60, '1 hora'], [120, '2 horas']];
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
let water: WaterReminder;
let reminders: ReminderStore;
let reminderWin: BrowserWindow | null = null;

/** Lo escondiste tú desde el menú; `hideUntil` es cuándo vuelve solo (null = hasta que lo llames). */
let userHidden = false;
let hideUntil: number | null = null;
/** Hay una app en pantalla completa sobre la pantalla del perro (solo se detecta en macOS). */
let fullscreenNow = false;
let fullscreenClear: NodeJS.Timeout | undefined;
let lastWindows: WindowRect[] = [];
/** Avisos que llegaron mientras estaba escondido por pantalla completa; se entregan al volver. */
let held: PetEvent[] = [];

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
  updateFullscreen();
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
    applyVisibility();
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

function hiddenByFullscreen(): boolean {
  return settings.hideOnFullscreen && fullscreenNow;
}

/** Muestra u oculta la ventana según lo que pediste y si hay algo en pantalla completa. */
function applyVisibility(): void {
  if (!win || win.isDestroyed()) return;
  const want = !userHidden && !hiddenByFullscreen();
  if (want && !win.isVisible()) {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  } else if (!want && win.isVisible()) {
    win.hide();
  }
  if (want && held.length > 0) {
    const pending = held;
    held = [];
    setTimeout(() => pending.forEach(send), 800);
  }
  refreshTray();
}

function showPet(): void {
  userHidden = false;
  hideUntil = null;
  applyVisibility();
}

/** `minutes` null = hasta que lo llames. */
function hidePet(minutes: number | null): void {
  userHidden = true;
  hideUntil = minutes === null ? null : Date.now() + minutes * 60_000;
  applyVisibility();
}

/** Un aviso que pediste: el perro aparece para darlo, salvo que haya algo en pantalla completa (espera a que termine). */
function notify(event: PetEvent): void {
  if (hiddenByFullscreen()) {
    if (held.length < 10) held.push(event);
    return;
  }
  showPet();
  send(event);
}

function updateFullscreen(): void {
  const display = currentDisplay();
  const now = isFullscreen(lastWindows, display.bounds, display.workArea);
  if (now) {
    clearTimeout(fullscreenClear);
    fullscreenClear = undefined;
    if (!fullscreenNow) {
      fullscreenNow = true;
      applyVisibility();
    }
  } else if (fullscreenNow && !fullscreenClear) {
    // Espera un poco antes de volver: en pantalla completa la barra de menú aparece un instante al acercar el cursor.
    fullscreenClear = setTimeout(() => {
      fullscreenClear = undefined;
      fullscreenNow = false;
      applyVisibility();
    }, 3000);
  }
}

// -------------------------------------------------------- recordatorios

function openReminderForm(): void {
  if (reminderWin && !reminderWin.isDestroyed()) {
    reminderWin.show();
    reminderWin.focus();
    return;
  }
  reminderWin = new BrowserWindow({
    width: 400,
    height: 340,
    useContentSize: true,
    title: 'Nuevo recordatorio',
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/reminder.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  reminderWin.setMenuBarVisibility(false);
  reminderWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  reminderWin.webContents.on('will-navigate', (event) => event.preventDefault());
  reminderWin.once('ready-to-show', () => {
    reminderWin?.show();
    if (isMac) app.focus({ steal: true });
    reminderWin?.focus();
  });
  reminderWin.on('closed', () => {
    reminderWin = null;
  });
  void reminderWin.loadFile(path.join(__dirname, '../reminder/index.html'));
}

function isFromReminderForm(event: IpcMainEvent): boolean {
  return reminderWin !== null && !reminderWin.isDestroyed() && event.sender === reminderWin.webContents;
}

function startTimer(minutes: number): void {
  reminders.add({ text: `¡Pasaron ${minutes} min!`, at: Date.now() + minutes * 60_000 });
  send({ type: 'notice', text: `Listo, te aviso en ${minutes} min.` });
  refreshTray();
}

function clock(at: number): string {
  const d = new Date(at);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? hhmm : `mañana ${hhmm}`;
}

function remindersMenu(): MenuItemConstructorOptions {
  const pending = reminders.list;
  const submenu: MenuItemConstructorOptions[] = [
    { label: 'Nuevo recordatorio…', click: openReminderForm },
    { label: 'Temporizador', submenu: TIMER_CHOICES.map((m) => ({ label: `${m} minutos`, click: () => startTimer(m) })) },
  ];
  if (pending.length > 0) {
    submenu.push({ type: 'separator' }, { label: 'Pendientes (clic para borrar)', enabled: false });
    for (const r of pending) {
      const text = r.text.length > 40 ? `${r.text.slice(0, 39)}…` : r.text;
      submenu.push({
        label: `${clock(r.at)} · ${text}${r.daily ? ' (diario)' : ''}`,
        click: () => {
          reminders.remove(r.id);
          refreshTray();
        },
      });
    }
  }
  return { label: pending.length > 0 ? `Recordatorios (${pending.length})` : 'Recordatorios', submenu };
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

function visibilityMenu(): MenuItemConstructorOptions[] {
  if (userHidden) {
    const left = hideUntil === null ? '' : ` (vuelve en ${Math.max(1, Math.ceil((hideUntil - Date.now()) / 60_000))} min)`;
    return [{ label: `Mostrar al perro${left}`, click: showPet }];
  }
  const items: MenuItemConstructorOptions[] = [{
    label: 'Ocultar al perro',
    submenu: [
      { label: 'Hasta que lo llame', click: () => hidePet(null) },
      ...HIDE_CHOICES.map(([m, label]) => ({ label: `Por ${label}`, click: () => hidePet(m) })),
    ],
  }];
  if (hiddenByFullscreen()) items.push({ label: 'Escondido: hay algo en pantalla completa', enabled: false });
  return items;
}

function buildMenu(): Menu {
  const shown = win !== null && !win.isDestroyed() && win.isVisible();
  const template: MenuItemConstructorOptions[] = [
    ...visibilityMenu(),
    { type: 'separator' },
    { label: 'Dar un premio', enabled: shown, click: () => send({ type: 'treat' }) },
    remindersMenu(),
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
      label: 'Avisarme de tomar agua',
      type: 'checkbox',
      checked: settings.waterReminders,
      click: (item) => updateSettings({ waterReminders: item.checked }),
    },
    {
      label: 'Agua cada',
      enabled: settings.waterReminders,
      submenu: WATER_CHOICES.map((m) => ({
        label: `${m} minutos`,
        type: 'radio' as const,
        checked: settings.waterEveryMin === m,
        click: () => updateSettings({ waterEveryMin: m }),
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
    ...(isMac
      ? [{
          label: 'Esconderse con pantalla completa',
          type: 'checkbox' as const,
          checked: settings.hideOnFullscreen,
          click: (item: Electron.MenuItem) => {
            updateSettings({ hideOnFullscreen: item.checked });
            applyVisibility();
          },
        }]
      : []),
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
  // Que el aviso de agua no pise el saludo de bienvenida ni el aviso de descanso.
  if (events.some((e) => e.type === 'back' || e.type === 'break-due')) water.postpone(now, 60_000);

  if (focus.tick(now)) {
    water.postpone(now, 60_000);
    // Si estaba oculto, aparece: pediste que te avisara.
    notify({ type: 'focus-end', completed: true, minutes: focus.minutes });
    tracker.snooze(now);
    refreshTray();
  } else if (focus.active) {
    const left = focus.remainingMin(now);
    if (left !== lastFocusMin) {
      lastFocusMin = left;
      refreshTray();
    }
  }

  if (hideUntil !== null && now >= hideUntil) showPet();

  // Los recordatorios esperan a que vuelvas si no hay nadie frente al equipo.
  if (!tracker.isAway) {
    const due = reminders.takeDue(now);
    if (due.length > 0) {
      water.postpone(now, 90_000);
      notify({ type: 'reminder', text: due.map((r) => r.text).join('\n') });
      refreshTray();
    }
  }

  const shown = win !== null && !win.isDestroyed() && win.isVisible();
  const thirsty = water.tick({
    now,
    enabled: settings.waterReminders && shown,
    everyMin: settings.waterEveryMin,
    away: tracker.isAway,
    quiet: focus.active,
  });
  if (thirsty) send({ type: 'water' });
}

// ---------------------------------------------------------------- app

function start(): void {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  settings = loadSettings(settingsFile);
  water = new WaterReminder(Date.now(), settings.waterEveryMin);
  reminders = new ReminderStore(path.join(app.getPath('userData'), 'reminders.json'));

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

  ipcMain.on('pet:menu', (event) => {
    if (!isFromPet(event) || !win) return;
    buildMenu().popup({ window: win });
  });

  ipcMain.on('reminder:add', (event, raw: unknown) => {
    if (!isFromReminderForm(event)) return;
    const reminder = parseRequest(raw, Date.now());
    if (reminder && reminders.add(reminder)) {
      send({ type: 'notice', text: `Anotado: te aviso ${reminder.daily ? 'todos los días a las' : 'a las'} ${clock(reminder.at).replace('mañana ', '')}.` });
    }
    reminderWin?.close();
    refreshTray();
  });

  ipcMain.on('reminder:close', (event) => {
    if (isFromReminderForm(event)) reminderWin?.close();
  });

  createWindow();
  createTray();

  const stopWatching = watchWindows((windows) => {
    lastWindows = windows;
    updateFullscreen();
  });
  app.on('before-quit', stopWatching);

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
