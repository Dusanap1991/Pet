import { $, panel } from './panel';

interface PanelSettings {
  name: string;
  sound: boolean;
  calendarUrl: string;
  meetingLeadMin: number;
  dropFolder: string;
  deviceAlerts: boolean;
  taskNudges: boolean;
}

const set = (patch: Partial<PanelSettings>): Promise<unknown> => panel().invoke('settings:set', patch);

const name = $<HTMLInputElement>('name');
const url = $<HTMLInputElement>('calendarUrl');
const lead = $<HTMLSelectElement>('meetingLeadMin');
const status = $<HTMLParagraphElement>('calendar-status');
const checks = ['sound', 'deviceAlerts', 'taskNudges'] as const;

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
  $('dropFolder').textContent = s.dropFolder || 'Sin carpeta: te pregunto cada vez';
  $('dropFolder').title = s.dropFolder;
  $<HTMLButtonElement>('clearFolder').hidden = !s.dropFolder;
}

name.addEventListener('change', () => void set({ name: name.value }));
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
