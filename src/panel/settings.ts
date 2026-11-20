import { $, panel } from './panel';

interface PanelSettings {
  name: string;
  sound: boolean;
  calendarUrl: string;
  meetingLeadMin: number;
  dropFolder: string;
  deviceAlerts: boolean;
  taskNudges: boolean;
  quietInMeetings: boolean;
  shortcuts: boolean;
  shortcutsOk: boolean;
  endOfDay: boolean;
  endOfDayTime: string;
  weeklySummary: boolean;
  lateNight: boolean;
  eyeBreaks: boolean;
  weatherCity: string;
  weatherPlace: string;
  costumes: boolean;
  coat: string;
  coats: [string, string][];
  style: string;
  waterGoal: number;
  waterGoals: number[];
}

const set = (patch: Partial<PanelSettings>): Promise<unknown> => panel().invoke('settings:set', patch);

const name = $<HTMLInputElement>('name');
const url = $<HTMLInputElement>('calendarUrl');
const lead = $<HTMLSelectElement>('meetingLeadMin');
const status = $<HTMLParagraphElement>('calendar-status');
const checks = [
  'sound', 'deviceAlerts', 'taskNudges', 'quietInMeetings', 'shortcuts', 'endOfDay', 'weeklySummary', 'lateNight', 'eyeBreaks', 'costumes',
] as const;
const coat = $<HTMLSelectElement>('coat');
const style = $<HTMLSelectElement>('style');
const waterGoal = $<HTMLSelectElement>('waterGoal');
const endTime = $<HTMLInputElement>('endOfDayTime');
const city = $<HTMLInputElement>('weatherCity');
const weatherStatus = $<HTMLParagraphElement>('weather-status');

// En Mac la tecla se llama Opción.
if (navigator.platform.toLowerCase().includes('mac')) for (const id of ['alt1', 'alt2', 'alt3', 'alt4']) $(id).textContent = '⌥ Opción';

function showStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  status.textContent = text;
  status.className = `status ${kind}`;
}

async function load(): Promise<void> {
  const s = await panel().invoke<PanelSettings>('settings:get');
  if (document.activeElement !== name) name.value = s.name;
  if (document.activeElement !== url) url.value = s.calendarUrl;
  lead.value = String(s.meetingLeadMin);
  for (const key of checks) $<HTMLInputElement>(key).checked = s[key];
  if (coat.options.length === 0) for (const [id, label] of s.coats) coat.add(new Option(label, id));
  coat.value = s.coat;
  style.value = s.style;
  if (waterGoal.options.length === 0) for (const n of s.waterGoals) waterGoal.add(new Option(String(n), String(n)));
  waterGoal.value = String(s.waterGoal);
  if (document.activeElement !== endTime) endTime.value = s.endOfDayTime;
  endTime.disabled = !s.endOfDay;
  if (document.activeElement !== city) city.value = s.weatherCity;
  if (s.weatherPlace && !weatherStatus.textContent) {
    weatherStatus.textContent = `Ubicación: ${s.weatherPlace}`;
    weatherStatus.className = 'status';
  }
  $('shortcuts-status').textContent = s.shortcuts && !s.shortcutsOk ? 'Algún atajo ya lo usa otra aplicación y no se pudo activar.' : '';
  $('dropFolder').textContent = s.dropFolder || 'Sin carpeta: te pregunto cada vez';
  $('dropFolder').title = s.dropFolder;
  $<HTMLButtonElement>('clearFolder').hidden = !s.dropFolder;
}

name.addEventListener('change', () => void set({ name: name.value }));
coat.addEventListener('change', () => void set({ coat: coat.value }));
style.addEventListener('change', () => void set({ style: style.value }));
waterGoal.addEventListener('change', () => void set({ waterGoal: Number(waterGoal.value) }));
endTime.addEventListener('change', () => void set({ endOfDayTime: endTime.value }));

async function testWeather(): Promise<void> {
  weatherStatus.textContent = 'Consultando…';
  weatherStatus.className = 'status';
  const r = await panel().invoke<{ ok: boolean; message: string }>('weather:test', city.value);
  weatherStatus.textContent = r.message;
  weatherStatus.className = `status ${r.ok ? 'ok' : 'error'}`;
}
city.addEventListener('change', () => {
  weatherStatus.textContent = '';
  void set({ weatherCity: city.value }).then(() => (city.value.trim() ? testWeather() : undefined));
});
$('weatherTest').addEventListener('click', () => void testWeather());
lead.addEventListener('change', () => void set({ meetingLeadMin: Number(lead.value) }));
for (const key of checks) {
  const box = $<HTMLInputElement>(key);
  box.addEventListener('change', () => void set({ [key]: box.checked }));
}

async function testCalendar(): Promise<void> {
  showStatus('Consultando…');
  const r = await panel().invoke<{ ok: boolean; message: string }>('calendar:test', url.value);
  showStatus(r.message, r.ok ? 'ok' : 'error');
}

url.addEventListener('change', () => {
  void set({ calendarUrl: url.value }).then(() => (url.value.trim() ? testCalendar() : showStatus('')));
});
$('test').addEventListener('click', () => void testCalendar());

$('choose').addEventListener('click', () => void panel().invoke('folder:choose').then(load));
$('clearFolder').addEventListener('click', () => void set({ dropFolder: '' }).then(load));

panel().on('settings:changed', () => void load());
void load();
