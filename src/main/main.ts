import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  screen,
  shell,
  Tray,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type Display,
  type Rectangle,
} from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Ambient, PetEvent, PetReport, PetSize } from '../shared/types';
import { ActivityTracker } from './activity';
import { FocusSession } from './focus';
import { Achievements, type Achievement, type Counter } from './achievements';
import { MeetingAlerts, currentMeeting, normalizeCalendarUrl, parseCalendar, type Meeting } from './calendar';
import { DeviceMonitor, type DeviceAlert } from './device';
import { cleanPaths, moveFiles } from './files';
import { HabitStore } from './habits';
import { isFullscreen, watchWindows, type WindowRect } from './fullscreen';
import { Mood, foodLabel, joyLabel } from './mood';
import { Pomodoro, POMODORO } from './pomodoro';
import { parseQuick } from './quick';
import { ReminderStore, parseRequest } from './reminders';
import { DailyTrigger, FRIDAY, WEEKDAYS, parseHHMM } from './schedule';
import { StatsStore } from './stats';
import { forecastUrl, geocodeUrl, parseForecast, parsePlace, weatherMessage, type Place } from './weather';
import { isSouthern, outfitFor } from '../shared/season';
import { TaskNudger, TaskStore } from './tasks';
import { checkForUpdate } from './updater';
import { WaterReminder } from './water';
import { BREAK_CHOICES, COATS, WATER_CHOICES, WATER_GOALS, loadSettings, sanitizeSettings, saveSettings, type Settings } from './settings';
import { dayKey } from './store';

declare const __PET_BUILD__: number;
declare const __PET_VERSION__: string;

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const FOCUS_CHOICES = [15, 25, 45];
const TIMER_CHOICES = [5, 10, 15, 20, 30, 45, 60];
const HIDE_CHOICES: [number, string][] = [[30, '30 minutos'], [60, '1 hora'], [120, '2 horas']];
const SIZES: [PetSize, string][] = [['s', 'Chico'], ['m', 'Mediano'], ['l', 'Grande']];
/** Cada cuánto se mira dónde está el cursor para saber si está sobre el perro. */
const CURSOR_POLL_MS = 33;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
const CALENDAR_REFRESH_MS = 10 * 60 * 1000;
const HUNGER_NUDGE_MS = 90 * 60 * 1000;

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

let stats: StatsStore;
let tasks: TaskStore;
let mood: Mood;
const nudger = new TaskNudger();
const device = new DeviceMonitor();
const meetingAlerts = new MeetingAlerts();
let meetings: Meeting[] = [];
let calendarFetchedAt = 0;
let battery: { level: number; charging: boolean } | null = null;
let lastWaterAt = 0;
let lastHungerNudge = 0;
let lastPlayReport = 0;
let lastMoodSent = '';
let currentDay = '';
let ballOut = false;
const panels: Partial<Record<PanelKind, BrowserWindow>> = {};
type PanelKind = 'day' | 'settings' | 'quick';

const pomodoro = new Pomodoro();
let achievements: Achievements;
let eyes: WaterReminder;
const endOfDay = new DailyTrigger(180, WEEKDAYS);
const weekly = new DailyTrigger(300, FRIDAY);
const lateNight = new DailyTrigger(240);
const morningWeather = new DailyTrigger(360);
/** Avisos que llegaron durante una reunión; se entregan juntos al terminar. */
let meetingHeld: string[] = [];
let wasInMeeting = false;
let earlyCountedDay = '';
let shortcutsOk = true;
let habits: HabitStore;
let ambientNow: Ambient = 'off';

const SHORTCUTS = { note: 'Control+Alt+N', focus: 'Control+Alt+F', pet: 'Control+Alt+P', come: 'Control+Alt+V' } as const;
const AMBIENTS: [Ambient, string][] = [['off', 'Apagado'], ['rain', 'Lluvia'], ['waves', 'Olas'], ['brown', 'Ruido marrón']];
const MOOD_EMOJI = ['', '😞', '😕', '😐', '🙂', '😄'];

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
      // Los ladridos suenan sin que tengas que hacer clic antes.
      autoplayPolicy: 'no-user-gesture-required',
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
    { label: `Versión ${__PET_VERSION__}`, enabled: false },
  ];
  if (updateReady) items.push({ label: `Reiniciar para actualizar (compilación ${updateReady})`, click: restartToUpdate });
  else if (app.isPackaged) items.push({ label: 'Buscar actualizaciones', click: () => void lookForUpdate(true) });
  return items;
}

// ------------------------------------------------------------ paneles

function openPanel(kind: PanelKind): void {
  const existing = panels[kind];
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const size = { day: [460, 820], settings: [500, 760], quick: [460, 150] }[kind];
  const w = new BrowserWindow({
    width: size[0],
    height: size[1],
    useContentSize: kind === 'quick',
    minWidth: kind === 'quick' ? 360 : 380,
    minHeight: kind === 'quick' ? 150 : 420,
    resizable: kind !== 'quick',
    minimizable: kind !== 'quick',
    maximizable: kind !== 'quick',
    alwaysOnTop: kind === 'quick',
    title: { day: 'Mi día', settings: 'Ajustes', quick: 'Nota rápida' }[kind],
    show: false,
    autoHideMenuBar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/panel.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  panels[kind] = w;
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (event) => event.preventDefault());
  w.once('ready-to-show', () => {
    w.show();
    if (isMac) app.focus({ steal: true });
    w.focus();
  });
  w.on('closed', () => {
    if (panels[kind] === w) delete panels[kind];
  });
  void w.loadFile(path.join(__dirname, `../panel/${kind}.html`));
}

function panelOf(event: Electron.IpcMainInvokeEvent | IpcMainEvent): PanelKind | null {
  for (const kind of ['day', 'settings', 'quick'] as const) {
    const w = panels[kind];
    if (w && !w.isDestroyed() && event.sender === w.webContents) return kind;
  }
  return null;
}

function dayView(): unknown {
  const now = Date.now();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    name: settings.name,
    tasks: tasks.list,
    today: stats.today(now),
    week: stats.history(now, 7).map((d) => ({ day: d.day, activeSec: d.stats.activeSec })),
    streak: stats.streak(now),
    mood: { ...mood.state, joyLabel: joyLabel(mood.state.joy), foodLabel: foodLabel(mood.state.food) },
    meetings: settings.calendarUrl
      ? meetings.filter((m) => m.end > now - 30 * 60_000 && m.start <= end.getTime()).map((m) => ({ title: m.title, start: m.start }))
      : null,
    taskNudges: settings.taskNudges,
    achievements: achievements.list(),
    waterGoal: settings.waterGoal,
    moodScore: stats.today(now).moodScore,
    weekMood: stats.history(now, 7).map((d) => d.stats.moodScore),
    habits: habits.list.map((h) => ({
      id: h.id,
      name: h.name,
      today: habits.doneOn(h, dayKey(now)),
      streak: habits.streak(h, now),
      week: stats.history(now, 7).map((d) => habits.doneOn(h, d.day)),
    })),
  };
}

function registerPanelHandlers(): void {
  const handle = (channel: string, kinds: PanelKind[], fn: (payload: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, payload: unknown) => {
      const kind = panelOf(event);
      if (!kind || !kinds.includes(kind)) throw new Error('No permitido');
      return fn(payload);
    });
  };

  handle('day:get', ['day'], () => dayView());
  handle('task:add', ['day'], (text) => {
    if (typeof text !== 'string') return null;
    const task = tasks.add(text, Date.now());
    if (task) nudger.markGreeted(Date.now());
    refreshTray();
    return task;
  });
  handle('task:toggle', ['day'], (id) => {
    if (typeof id !== 'string') return null;
    const done = tasks.toggle(id, Date.now());
    if (done === true) {
      stats.add(Date.now(), 'tasksDone');
      mood.apply('task');
      bump('tasks');
      nudger.postpone(Date.now());
      const left = tasks.pending.length;
      send({ type: 'notice', text: left === 0 ? '¡Terminaste todo! 🎉' : `¡Una menos! Quedan ${left}.` });
    } else if (done === false) {
      stats.add(Date.now(), 'tasksDone', -1);
    }
    refreshTray();
    return done;
  });
  handle('habit:add', ['day'], (name) => (typeof name === 'string' ? habits.add(name, Date.now()) : null));
  handle('habit:remove', ['day'], (id) => {
    if (typeof id === 'string') habits.remove(id);
    return true;
  });
  handle('habit:toggle', ['day'], (id) => {
    if (typeof id !== 'string') return null;
    const done = habits.toggle(id, Date.now());
    if (done) {
      bump('habits');
      const h = habits.list.find((x) => x.id === id);
      const streak = h ? habits.streak(h, Date.now()) : 0;
      send({ type: 'notice', text: streak > 1 ? `¡${h?.name}: ${streak} días seguidos! 🌱` : `¡Bien! ${h?.name} ✔️` });
    }
    return done;
  });
  handle('mood:set', ['day'], (score) => {
    if (typeof score !== 'number' || score < 1 || score > 5) return false;
    stats.setMood(Date.now(), score);
    stats.save();
    send({ type: 'notice', text: score >= 4 ? `¡Qué bueno! ${MOOD_EMOJI[score]}` : score === 3 ? 'Gracias por contarme.' : `Mañana será mejor. Aquí estoy ${MOOD_EMOJI[score]}` });
    return true;
  });
  handle('task:remove', ['day'], (id) => {
    if (typeof id === 'string') tasks.remove(id);
    refreshTray();
    return true;
  });

  handle('settings:get', ['settings'], () => ({
    name: settings.name,
    sound: settings.sound,
    calendarUrl: settings.calendarUrl,
    meetingLeadMin: settings.meetingLeadMin,
    dropFolder: settings.dropFolder,
    deviceAlerts: settings.deviceAlerts,
    taskNudges: settings.taskNudges,
    quietInMeetings: settings.quietInMeetings,
    shortcuts: settings.shortcuts,
    shortcutsOk,
    endOfDay: settings.endOfDay,
    endOfDayTime: settings.endOfDayTime,
    weeklySummary: settings.weeklySummary,
    lateNight: settings.lateNight,
    eyeBreaks: settings.eyeBreaks,
    weatherCity: settings.weatherCity,
    weatherPlace: settings.weatherPlace?.name ?? '',
    costumes: settings.costumes,
    coat: settings.coat,
    coats: COATS,
    style: settings.style,
    waterGoal: settings.waterGoal,
    waterGoals: WATER_GOALS,
  }));
  handle('settings:set', ['settings'], (patch) => {
    if (typeof patch !== 'object' || patch === null) return false;
    const allowed = [
      'name', 'sound', 'calendarUrl', 'meetingLeadMin', 'dropFolder', 'deviceAlerts', 'taskNudges', 'quietInMeetings',
      'shortcuts', 'endOfDay', 'endOfDayTime', 'weeklySummary', 'lateNight', 'eyeBreaks', 'weatherCity', 'costumes', 'coat', 'style', 'waterGoal',
    ];
    const picked = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    const next = sanitizeSettings({ ...settings, ...picked });
    const renamed = next.name !== settings.name;
    const calendarChanged = next.calendarUrl !== settings.calendarUrl;
    const cityChanged = next.weatherCity !== settings.weatherCity;
    const shortcutsChanged = next.shortcuts !== settings.shortcuts;
    if (cityChanged) next.weatherPlace = null;
    updateSettings(next);
    if (shortcutsChanged) registerShortcuts();
    if (cityChanged && next.weatherCity) void locate(next.weatherCity).catch(() => {});
    if (renamed && next.name) send({ type: 'notice', text: `¡Me encanta! Ahora me llamo ${next.name}.` });
    if (calendarChanged) {
      meetings = [];
      calendarFetchedAt = 0;
      void refreshCalendar();
    }
    return true;
  });
  handle('calendar:test', ['settings'], async (raw) => {
    const url = normalizeCalendarUrl(typeof raw === 'string' ? raw : '');
    if (!url) return { ok: false, message: 'La dirección tiene que empezar con https:// o webcal://.' };
    try {
      const now = Date.now();
      const found = parseCalendar(await fetchCalendar(url), now, now + 7 * 86_400_000);
      const today = found.filter((m) => dayKey(m.start) === dayKey(now)).length;
      return { ok: true, message: `Funciona: ${found.length} reunion${found.length === 1 ? '' : 'es'} en los próximos 7 días (${today} hoy).` };
    } catch (err) {
      return { ok: false, message: `No pude leer el calendario: ${(err as Error).message}` };
    }
  });
  handle('weather:test', ['settings'], async (raw) => {
    const city = typeof raw === 'string' ? raw.trim() : '';
    if (!city) return { ok: false, message: 'Escribe tu ciudad.' };
    try {
      const place = await locate(city);
      if (!place) return { ok: false, message: `No encontré "${city}". Prueba con otro nombre.` };
      const forecast = await fetchForecast(place);
      return { ok: true, message: `${weatherMessage(place.name, forecast)} (${place.name})` };
    } catch (err) {
      return { ok: false, message: `No pude consultar el clima: ${(err as Error).message}` };
    }
  });
  handle('quick:add', ['quick'], (raw) => {
    const note = parseQuick(typeof raw === 'string' ? raw : '', Date.now());
    panels.quick?.close();
    if (!note) return false;
    if (note.kind === 'task') {
      if (tasks.add(note.text, Date.now())) {
        nudger.markGreeted(Date.now());
        send({ type: 'notice', text: `Anotado en tus tareas: ${note.text}` });
      }
    } else if (reminders.add({ text: note.text, at: note.at })) {
      send({ type: 'notice', text: `Listo, te aviso a las ${clock(note.at).replace('mañana ', '')}: ${note.text}` });
    }
    dayChanged();
    refreshTray();
    return true;
  });
  handle('folder:choose', ['settings'], async () => {
    const owner = panels.settings;
    const options: Electron.OpenDialogOptions = { title: 'Carpeta para los archivos que sueltes sobre el perro', properties: ['openDirectory', 'createDirectory'] };
    const r = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (!r.canceled && r.filePaths[0]) updateSettings({ dropFolder: r.filePaths[0] });
    return settings.dropFolder;
  });

  ipcMain.on('panel:close', (event) => {
    const kind = panelOf(event);
    if (kind) panels[kind]?.close();
  });
}

// ------------------------------------------------------------ calendario

async function fetchCalendar(url: string): Promise<string> {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'la dirección no existe (404)' : `respuesta ${res.status}`);
  const text = await res.text();
  if (text.length > 10_000_000) throw new Error('el calendario es demasiado grande');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('eso no parece un calendario iCal');
  return text;
}

async function refreshCalendar(): Promise<void> {
  const url = normalizeCalendarUrl(settings.calendarUrl);
  if (!url) {
    meetings = [];
    return;
  }
  calendarFetchedAt = Date.now();
  try {
    const now = Date.now();
    meetings = parseCalendar(await fetchCalendar(url), now - 3600_000, now + 36 * 3600_000);
    dayChanged();
  } catch (err) {
    // Sin conexión o calendario caído: se conservan las reuniones que ya tenía.
    console.error('No se pudo leer el calendario:', err);
  }
}

function meetingText(m: Meeting): string {
  const mins = Math.round((m.start - Date.now()) / 60_000);
  return mins <= 0 ? `📅 Empieza ahora: ${m.title}` : `📅 En ${mins} min: ${m.title}`;
}

// -------------------------------------------------------------- archivos

function moveDropped(paths: string[], dir: string): void {
  try {
    const r = moveFiles(paths, dir);
    if (r.moved) bump('files', r.moved);
    const where = path.basename(dir) || dir;
    const skipped = r.skipped.length ? ` (no pude mover ${r.skipped.length})` : '';
    send({ type: 'notice', text: r.moved ? `Listo, dejé ${r.moved} en "${where}"${skipped}.` : `No moví nada${skipped}.` });
  } catch (err) {
    send({ type: 'notice', text: `No pude mover los archivos: ${(err as Error).message}` });
  }
}

async function trashDropped(paths: string[]): Promise<void> {
  let n = 0;
  for (const p of paths) {
    try {
      await shell.trashItem(p);
      n++;
    } catch (err) {
      console.error('No se pudo mandar a la papelera:', p, err);
    }
  }
  if (n) bump('files', n);
  const failed = paths.length - n;
  send({ type: 'notice', text: `¡Ñam! ${n} a la papelera.${failed ? ` No pude con ${failed}.` : ''}` });
}

async function chooseAndMove(paths: string[]): Promise<void> {
  const options: Electron.OpenDialogOptions = { title: '¿Adónde los llevo?', buttonLabel: 'Mover aquí', properties: ['openDirectory', 'createDirectory'] };
  if (isMac) app.focus({ steal: true });
  const r = await dialog.showOpenDialog(options);
  if (r.canceled || !r.filePaths[0]) return;
  // La próxima vez aparece como opción rápida.
  updateSettings({ dropFolder: r.filePaths[0] });
  moveDropped(paths, r.filePaths[0]);
}

function onDrop(raw: unknown): void {
  const paths = cleanPaths(raw);
  if (paths.length === 0 || !win) return;
  const what = paths.length === 1 ? `"${path.basename(paths[0])}"` : `${paths.length} archivos`;
  const items: MenuItemConstructorOptions[] = [{ label: what, enabled: false }, { type: 'separator' }];
  if (settings.dropFolder && fs.existsSync(settings.dropFolder)) {
    items.push({ label: `Mover a "${path.basename(settings.dropFolder)}"`, click: () => moveDropped(paths, settings.dropFolder) });
  }
  items.push(
    { label: 'Mover a otra carpeta…', click: () => void chooseAndMove(paths) },
    { label: 'Mandar a la papelera', click: () => void trashDropped(paths) },
    { type: 'separator' },
    { label: 'Cancelar' },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------------------------------------------------------- lo que cuenta el perro

function onReport(kind: PetReport): void {
  const now = Date.now();
  switch (kind) {
    case 'pet':
      stats.add(now, 'pets');
      mood.apply('pet');
      bump('pets');
      break;
    case 'treat':
      stats.add(now, 'treats');
      mood.apply('treat');
      bump('treats');
      break;
    case 'play':
      if (now - lastPlayReport < 15_000) return;
      lastPlayReport = now;
      mood.apply('play');
      bump('play');
      break;
    case 'drank': {
      // Solo cuenta si hubo un aviso de agua hace poco.
      if (now - lastWaterAt > 3 * 60_000) return;
      lastWaterAt = 0;
      stats.add(now, 'water');
      mood.apply('water');
      bump('water');
      const n = stats.today(now).water;
      if (n === settings.waterGoal) {
        bump('waterGoals');
        send({ type: 'notice', text: `🎉 ¡Meta de agua cumplida! ${n} vasos hoy.` });
      } else {
        const left = settings.waterGoal - n;
        send({ type: 'notice', text: `¡Bien! ${n === 1 ? 'Primer vaso' : `Van ${n} vasos`} de hoy 💧${left > 0 ? ` (faltan ${left})` : ''}` });
      }
      break;
    }
    case 'stretched':
      stats.add(now, 'stretches');
      stats.add(now, 'breaks');
      mood.apply('play');
      bump('stretches');
      tracker.snooze(now);
      break;
  }
  sendMood();
  dayChanged();
}

function deviceText(a: DeviceAlert): string {
  switch (a.kind) {
    case 'battery':
      return `🔋 Me queda poca batería: ${a.percent}%. ¿Me enchufas?`;
    case 'offline':
      return '🔌 Se cayó internet.';
    case 'online':
      return '¡Volvió internet!';
    case 'restart':
      return `El equipo lleva ${a.days} días sin reiniciarse. Cuando puedas, reinícialo: anda más rápido.`;
  }
}

function setBall(out: boolean): void {
  ballOut = out;
  if (out) showPet();
  send({ type: 'ball', out });
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
  if (['size', 'sound', 'name', 'coat', 'costumes', 'weatherPlace', 'style'].some((k) => k in patch)) sendSettings();
  for (const w of Object.values(panels)) if (w && !w.isDestroyed()) w.webContents.send('settings:changed');
  refreshTray();
}

function sendSettings(): void {
  const south = isSouthern(Intl.DateTimeFormat().resolvedOptions().timeZone, settings.weatherPlace?.lat);
  const outfit = settings.costumes ? outfitFor(new Date(), south) : null;
  send({ type: 'settings', size: settings.size, sound: settings.sound, name: settings.name, coat: settings.coat, outfit, style: settings.style });
}

function sendMood(force = false): void {
  const s = mood.state;
  const key = `${Math.round(s.joy)}/${Math.round(s.food)}`;
  if (!force && key === lastMoodSent) return;
  lastMoodSent = key;
  send({ type: 'mood', joy: s.joy, food: s.food });
}

/** Avisa a "Mi día" (si está abierta) que algo cambió. */
function dayChanged(): void {
  const w = panels.day;
  if (w && !w.isDestroyed()) w.webContents.send('day:changed');
}

function focusing(): boolean {
  return focus.active || pomodoro.inFocus;
}

function inMeeting(now: number): boolean {
  return settings.quietInMeetings && !!settings.calendarUrl && currentMeeting(meetings, now) !== null;
}

/** Un aviso que no es urgente: durante una reunión espera a que termine. */
function gentle(text: string): void {
  if (inMeeting(Date.now())) {
    if (!meetingHeld.includes(text) && meetingHeld.length < 6) meetingHeld.push(text);
    return;
  }
  send({ type: 'notice', text });
}

function bump(counter: Counter, n = 1): void {
  celebrate(achievements.bump(counter, n));
}

function celebrate(fresh: Achievement[]): void {
  for (const a of fresh) gentle(`🏅 ¡Logro desbloqueado! ${a.icon} ${a.title}`);
  if (fresh.length) dayChanged();
}

function startPomodoro(): void {
  if (focus.active) focus.cancel();
  pomodoro.start(Date.now());
  showPet();
  send({ type: 'focus-start', minutes: POMODORO.focus });
  refreshTray();
}

function stopPomodoro(): void {
  if (pomodoro.stop()) send({ type: 'focus-end', completed: false, minutes: 0 });
  refreshTray();
}

/** Atajo de foco: si hay algo en curso lo detiene; si no, empieza 25 minutos. */
function toggleFocus(): void {
  if (pomodoro.active) stopPomodoro();
  else if (focus.active) cancelFocus();
  else startFocus(25);
}

function focusMenu(): MenuItemConstructorOptions {
  const now = Date.now();
  if (pomodoro.active) {
    const step = pomodoro.current!;
    const what = step.phase === 'focus' ? `foco ${step.round} de ${POMODORO.rounds}` : step.phase === 'break' ? 'descanso' : 'descanso largo';
    return { label: `Detener Pomodoro (${what}, quedan ${pomodoro.remainingMin(now)} min)`, click: stopPomodoro };
  }
  if (focus.active) return { label: `Cancelar foco (quedan ${focus.remainingMin(now)} min)`, click: cancelFocus };
  return {
    label: 'Sesión de foco',
    submenu: [
      ...FOCUS_CHOICES.map((m) => ({ label: `${m} minutos`, click: () => startFocus(m) })),
      { type: 'separator' as const },
      { label: `Pomodoro (${POMODORO.focus} + ${POMODORO.break}, ${POMODORO.rounds} vueltas)`, click: startPomodoro },
    ],
  };
}

function startFocus(minutes: number): void {
  pomodoro.stop();
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
    ...(settings.name ? [{ label: `🐶 ${settings.name}`, enabled: false }] : []),
    ...(inMeeting(Date.now()) ? [{ label: '📅 En reunión: avisos en pausa', enabled: false }] : []),
    ...visibilityMenu(),
    { type: 'separator' },
    { label: 'Dar un premio', enabled: shown, click: () => send({ type: 'treat' }) },
    ballOut
      ? { label: 'Guardar la pelota', click: () => setBall(false) }
      : { label: 'Jugar a la pelota', enabled: shown, click: () => setBall(true) },
    { label: tasks.pending.length ? `Mi día (${tasks.pending.length} pendientes)…` : 'Mi día…', click: () => openPanel('day') },
    {
      label: 'Ven aquí',
      enabled: shown || userHidden,
      accelerator: settings.shortcuts && shortcutsOk ? SHORTCUTS.come : undefined,
      registerAccelerator: false,
      click: comeHere,
    },
    { label: 'Rutina de estiramiento (2 min)', click: startStretch },
    {
      label: 'Sonido ambiente',
      submenu: [
        ...AMBIENTS.map(([id, label]) => ({
          label,
          type: 'radio' as const,
          checked: settings.ambient === id,
          click: () => {
            updateSettings({ ambient: id });
            syncAmbient();
          },
        })),
        { type: 'separator' as const },
        {
          label: 'Solo durante el foco',
          type: 'checkbox' as const,
          checked: settings.ambientFocusOnly,
          click: (item: Electron.MenuItem) => {
            updateSettings({ ambientFocusOnly: item.checked });
            syncAmbient();
          },
        },
      ],
    },
    remindersMenu(),
    {
      label: 'Nota rápida…',
      accelerator: settings.shortcuts && shortcutsOk ? SHORTCUTS.note : undefined,
      registerAccelerator: false,
      click: () => openPanel('quick'),
    },
    focusMenu(),
    { type: 'separator' },
    {
      label: 'Avisos',
      submenu: [
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
      ],
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
    { label: 'Ajustes…', click: () => openPanel('settings') },
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
  const title = settings.name || 'Pet';
  const now = Date.now();
  tray.setToolTip(
    pomodoro.active ? `${title}: Pomodoro, quedan ${pomodoro.remainingMin(now)} min`
      : focus.active ? `${title}: foco, quedan ${focus.remainingMin(now)} min` : title,
  );
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
    breaksEnabled: settings.breakReminders && !focusing() && !inMeeting(now),
    breakEveryMin: settings.breakEveryMin,
  });
  for (const event of events) send(event);
  if (!tracker.isAway) stats.addActive(now, 1);
  for (const e of events) if (e.type === 'back' && e.awaySec >= 300) stats.add(now, 'breaks');
  // Que el aviso de agua no pise el saludo de bienvenida ni el aviso de descanso.
  if (events.some((e) => e.type === 'back' || e.type === 'break-due')) water.postpone(now, 60_000);

  if (focus.tick(now)) {
    water.postpone(now, 60_000);
    // Si estaba oculto, aparece: pediste que te avisara.
    notify({ type: 'focus-end', completed: true, minutes: focus.minutes });
    stats.add(now, 'focusSessions');
    stats.add(now, 'focusMin', focus.minutes);
    bump('focus');
    tracker.snooze(now);
    refreshTray();
  } else if (focus.active) {
    const left = focus.remainingMin(now);
    if (left !== lastFocusMin) {
      lastFocusMin = left;
      refreshTray();
    }
  }

  tickPomodoro(now);

  if (hideUntil !== null && now >= hideUntil) showPet();

  // Los recordatorios esperan a que vuelvas si no hay nadie frente al equipo.
  if (!tracker.isAway) {
    const due = reminders.takeDue(now);
    if (due.length > 0) {
      water.postpone(now, 90_000);
      notify({ type: 'reminder', text: due.map((r) => r.text).join('\n') });
      bump('reminders', due.length);
      refreshTray();
    }
  }

  const shown = win !== null && !win.isDestroyed() && win.isVisible();
  const thirsty = water.tick({
    now,
    enabled: settings.waterReminders && shown,
    everyMin: settings.waterEveryMin,
    away: tracker.isAway,
    quiet: focusing() || inMeeting(now),
  });
  if (thirsty) {
    lastWaterAt = now;
    send({ type: 'water' });
  }

  const tired = eyes.tick({ now, enabled: settings.eyeBreaks && shown, everyMin: 20, away: tracker.isAway, quiet: inMeeting(now) || thirsty });
  if (tired) send({ type: 'eyes' });

  syncAmbient();
  tickDay(now, shown);
}

function tickPomodoro(now: number): void {
  const change = pomodoro.tick(now);
  if (!change) {
    if (pomodoro.active) {
      const left = pomodoro.remainingMin(now);
      if (left !== lastFocusMin) {
        lastFocusMin = left;
        refreshTray();
      }
    }
    return;
  }
  const { ended, next } = change;
  if (ended.phase === 'focus') {
    stats.add(now, 'focusSessions');
    stats.add(now, 'focusMin', ended.minutes);
    bump('focus');
    if (next.phase === 'long-break') bump('pomodoros');
    tracker.snooze(now);
    water.postpone(now, 60_000);
    send({ type: 'focus-end', completed: false, minutes: ended.minutes });
    notify({
      type: 'notice',
      text: next.phase === 'long-break'
        ? `🍅 ¡Vuelta completa! ${POMODORO.rounds} focos listos. Descanso largo de ${next.minutes} min: levántate y camina un poco.`
        : `🍅 Foco ${ended.round} de ${POMODORO.rounds} listo. Descanso de ${next.minutes} min: estírate y toma agua.`,
    });
  } else {
    notify({ type: 'focus-start', minutes: next.minutes });
  }
  refreshTray();
}

/** Lo que no necesita revisarse cada segundo: tareas, ánimo, equipo, reuniones. */
let slowTick = 0;
function tickDay(now: number, shown: boolean): void {
  // Las reuniones sí se revisan cada segundo: el aviso tiene que llegar a tiempo.
  if (settings.calendarUrl) {
    for (const m of meetingAlerts.tick(now, meetings, settings.meetingLeadMin)) {
      water.postpone(now, 90_000);
      notify({ type: 'reminder', text: meetingText(m) });
    }
    if (now - calendarFetchedAt > CALENDAR_REFRESH_MS) void refreshCalendar();
  }

  // Al terminar una reunión, entrega lo que quedó esperando.
  const meetingNow = inMeeting(now);
  if (meetingNow !== wasInMeeting) {
    wasInMeeting = meetingNow;
    refreshTray();
    if (!meetingNow && meetingHeld.length > 0) {
      const lines = meetingHeld.map((t) => `• ${t.split('\n')[0]}`).join('\n');
      meetingHeld = [];
      setTimeout(() => send({ type: 'notice', text: `Mientras estabas en la reunión:\n${lines}` }), 3000);
    }
  }

  if (++slowTick % 5 !== 0) return;
  const away = tracker.isAway;
  const quiet = focusing() || !shown || meetingNow;

  const today = dayKey(now);
  if (today !== currentDay) {
    currentDay = today;
    tasks.rollover(now);
    sendSettings();
    dayChanged();
    refreshTray();
  }

  const pending = tasks.pending;
  const nudge = nudger.tick({ now, pending: pending.length, enabled: settings.taskNudges, away, quiet });
  if (nudge) {
    const list = pending.slice(0, 3).map((t) => `• ${t.text}`).join('\n');
    const more = pending.length > 3 ? `\n…y ${pending.length - 3} más` : '';
    const head = nudge === 'morning' ? `¡Buen día! Para hoy tienes ${pending.length}:` : `Te quedan ${pending.length} pendiente${pending.length === 1 ? '' : 's'}:`;
    water.postpone(now, 60_000);
    send({ type: 'notice', text: `${head}\n${list}${more}` });
  }

  const alerts = device.tick({
    now,
    enabled: settings.deviceAlerts,
    away,
    online: net.isOnline(),
    battery,
    uptimeSec: os.uptime(),
  });
  for (const a of alerts) {
    if (a.kind === 'battery') notify({ type: 'reminder', text: deviceText(a) });
    else gentle(deviceText(a));
  }

  mood.decay(5000, away);
  sendMood();
  if (mood.hungry && !away && !quiet && now - lastHungerNudge > HUNGER_NUDGE_MS) {
    lastHungerNudge = now;
    send({ type: 'notice', text: 'Tengo hambre… ¿me das un premio? 🦴' });
  }

  tickDaily(now, away, meetingNow, shown);

  if (slowTick % 60 === 0) {
    celebrate(achievements.update({ streak: stats.streak(now), named: !!settings.name }));
    stats.save();
    mood.save();
    dayChanged();
  }
}

function hm(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** Fin de jornada, resumen semanal, aviso de noche, clima de la mañana y "madrugador". */
function tickDaily(now: number, away: boolean, meetingNow: boolean, shown: boolean): void {
  const d = new Date(now);
  const today = stats.today(now);
  const ready = !away && !meetingNow && shown;

  if (!away && d.getHours() < 8 && d.getHours() >= 4 && earlyCountedDay !== dayKey(now)) {
    earlyCountedDay = dayKey(now);
    bump('early');
  }

  const end = parseHHMM(settings.endOfDayTime) ?? { h: 18, m: 0 };
  if (endOfDay.tick({ now, ...end, enabled: settings.endOfDay, ready: ready && today.activeSec >= 30 * 60 })) {
    const parts = [`${hm(today.activeSec)} frente al equipo`];
    if (today.breaks) parts.push(`${today.breaks} pausa${today.breaks === 1 ? '' : 's'}`);
    if (today.focusSessions) parts.push(`${today.focusSessions} foco${today.focusSessions === 1 ? '' : 's'}`);
    if (today.tasksDone) parts.push(`${today.tasksDone} tarea${today.tasksDone === 1 ? '' : 's'} hecha${today.tasksDone === 1 ? '' : 's'}`);
    const pending = tasks.pending;
    const tomorrow = pending.length ? `\nPara mañana: ${pending.slice(0, 3).map((t) => t.text).join(', ')}${pending.length > 3 ? '…' : ''}` : '';
    const ask = today.moodScore ? '' : '\n¿Cómo estuvo tu día? Cuéntamelo en Mi día.';
    notify({ type: 'notice', text: `🏁 Son las ${settings.endOfDayTime}. ¡Hora de cortar!\nHoy: ${parts.join(', ')}.${tomorrow}${ask}` });
  }

  if (weekly.tick({ now, h: 16, m: 0, enabled: settings.weeklySummary, ready })) {
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const week = stats.history(now, 7).filter((x) => new Date(`${x.day}T12:00:00`).getTime() >= monday.getTime());
    const sum = (k: 'activeSec' | 'focusSessions' | 'water' | 'tasksDone'): number => week.reduce((a, x) => a + x.stats[k], 0);
    const best = week.reduce((a, x) => (x.stats.activeSec > a.stats.activeSec ? x : a), week[0]);
    const bestName = best ? new Date(`${best.day}T12:00:00`).toLocaleDateString('es', { weekday: 'long' }) : '';
    const bits = [`${hm(sum('activeSec'))} frente al equipo`, `${sum('focusSessions')} focos`, `${sum('water')} vasos de agua`, `${sum('tasksDone')} tareas`];
    const moods = week.map((x) => x.stats.moodScore).filter((m) => m > 0);
    const avg = moods.length ? MOOD_EMOJI[Math.round(moods.reduce((a, m) => a + m, 0) / moods.length)] : '';
    notify({ type: 'notice', text: `📊 Tu semana: ${bits.join(', ')}.${bestName ? `\nTu mejor día fue el ${bestName}.` : ''}${avg ? `\nÁnimo de la semana: ${avg}` : ''}\n¡Buen fin de semana!` });
  }

  if (lateNight.tick({ now, h: 23, m: 0, enabled: settings.lateNight, ready: ready && today.activeSec >= 10 * 60 })) {
    gentle('🌙 Ya es tarde. ¿Y si lo dejamos para mañana? Yo ya tengo sueño.');
  }

  if (settings.weatherPlace && morningWeather.tick({ now, h: 6, m: 0, enabled: true, ready })) {
    const place = settings.weatherPlace;
    void fetchForecast(place)
      .then((f) => gentle(weatherMessage(place.name, f)))
      .catch((err) => console.error('No se pudo consultar el clima:', err));
  }
}

// ------------------------------------------------------------------ clima

async function getJson(url: string): Promise<unknown> {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`respuesta ${res.status}`);
  return res.json();
}

/** Busca la ciudad y la guarda en la configuración. */
async function locate(city: string): Promise<Place | null> {
  const place = parsePlace(await getJson(geocodeUrl(city)));
  if (place && settings.weatherCity === city.trim()) updateSettings({ weatherPlace: place });
  return place;
}

async function fetchForecast(place: Place) {
  const f = parseForecast(await getJson(forecastUrl(place)));
  if (!f) throw new Error('respuesta sin pronóstico');
  return f;
}

// ------------------------------------------------- llamar, estirar, sonido

/** El perro corre hasta donde está el cursor (si está en otra pantalla, se muda allá). */
function comeHere(): void {
  const point = screen.getCursorScreenPoint();
  const under = screen.getDisplayNearestPoint(point);
  if (under.id !== currentDisplay().id) moveToDisplay(under);
  showPet();
  send({ type: 'come', x: point.x - bounds.x });
}

function startStretch(): void {
  showPet();
  send({ type: 'stretch' });
}

/** Qué sonido ambiente corresponde ahora (puede ser "solo durante el foco"). */
function wantedAmbient(): Ambient {
  if (settings.ambient === 'off' || tracker.isAway) return 'off';
  if (settings.ambientFocusOnly && !focusing()) return 'off';
  return settings.ambient;
}

function syncAmbient(force = false): void {
  const want = wantedAmbient();
  if (want === ambientNow && !force) return;
  ambientNow = want;
  send({ type: 'ambient', kind: want });
}

// ---------------------------------------------------------------- atajos

function registerShortcuts(): void {
  globalShortcut.unregisterAll();
  shortcutsOk = true;
  if (!settings.shortcuts) return refreshTray();
  const actions: [string, () => void][] = [
    [SHORTCUTS.note, () => openPanel('quick')],
    [SHORTCUTS.focus, toggleFocus],
    [SHORTCUTS.pet, () => (userHidden ? showPet() : hidePet(null))],
    [SHORTCUTS.come, comeHere],
  ];
  for (const [accel, fn] of actions) {
    try {
      if (!globalShortcut.register(accel, fn)) shortcutsOk = false;
    } catch {
      shortcutsOk = false;
    }
  }
  refreshTray();
}

// ---------------------------------------------------------------- app

function start(): void {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  settings = loadSettings(settingsFile);
  water = new WaterReminder(Date.now(), settings.waterEveryMin);
  reminders = new ReminderStore(path.join(app.getPath('userData'), 'reminders.json'));
  stats = new StatsStore(path.join(app.getPath('userData'), 'stats.json'));
  tasks = new TaskStore(path.join(app.getPath('userData'), 'tasks.json'));
  mood = new Mood(path.join(app.getPath('userData'), 'mood.json'));
  achievements = new Achievements(path.join(app.getPath('userData'), 'achievements.json'));
  habits = new HabitStore(path.join(app.getPath('userData'), 'habits.json'));
  eyes = new WaterReminder(Date.now(), 20);
  registerPanelHandlers();

  if (isWin) app.setAppUserModelId('com.dusanap1991.pet');
  if (isMac) app.dock?.hide();

  ipcMain.on('pet:ready', (event) => {
    if (!isFromPet(event)) return;
    rendererReady = true;
    sendSettings();
    sendMood(true);
    if (ballOut) send({ type: 'ball', out: true });
    syncAmbient(true);
    if (tracker.isAway) send({ type: 'away' });
    if (focus.active) send({ type: 'focus-start', minutes: focus.minutes });
    if (pomodoro.inFocus) send({ type: 'focus-start', minutes: pomodoro.remainingMin(Date.now()) });
  });

  ipcMain.on('pet:set-interactive', (event, on: unknown) => {
    if (!isFromPet(event)) return;
    win?.setIgnoreMouseEvents(on !== true);
  });

  ipcMain.on('pet:dragging', (event, on: unknown) => {
    if (!isFromPet(event)) return;
    dragging = on === true;
  });

  ipcMain.on('pet:report', (event, kind: unknown) => {
    if (!isFromPet(event)) return;
    if (kind === 'pet' || kind === 'treat' || kind === 'play' || kind === 'drank' || kind === 'stretched') onReport(kind);
  });

  ipcMain.on('pet:battery', (event, level: unknown, charging: unknown) => {
    if (!isFromPet(event)) return;
    battery = typeof level === 'number' && level >= 0 && level <= 1 ? { level, charging: charging === true } : null;
  });

  ipcMain.on('pet:drop', (event, paths: unknown) => {
    if (isFromPet(event)) onDrop(paths);
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
  registerShortcuts();
  app.on('will-quit', () => globalShortcut.unregisterAll());

  const stopWatching = watchWindows((windows) => {
    lastWindows = windows;
    updateFullscreen();
  });
  app.on('before-quit', stopWatching);
  app.on('before-quit', () => {
    stats.save();
    mood.save();
  });
  void refreshCalendar();

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
