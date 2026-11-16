import { $, el, panel } from './panel';

interface Task {
  id: string;
  text: string;
  done: boolean;
}

interface DayView {
  name: string;
  tasks: Task[];
  today: { activeSec: number; breaks: number; focusSessions: number; focusMin: number; water: number; tasksDone: number; pets: number };
  week: { day: string; activeSec: number }[];
  streak: number;
  mood: { joy: number; food: number; joyLabel: string; foodLabel: string };
  meetings: { title: string; start: number }[] | null;
  taskNudges: boolean;
}

const hm = (sec: number): string => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const clock = (ms: number): string => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const weekday = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'short' }).replace('.', '');
};

function renderTasks(tasks: Task[], nudges: boolean): void {
  const list = $<HTMLUListElement>('tasks');
  list.replaceChildren(
    ...tasks.map((t) => {
      const box = el('input', { type: 'checkbox', checked: t.done });
      box.addEventListener('change', () => void panel().invoke('task:toggle', t.id).then(load));
      const del = el('button', { type: 'button', className: 'icon', title: 'Borrar', textContent: '×' });
      del.setAttribute('aria-label', `Borrar "${t.text}"`);
      del.addEventListener('click', () => void panel().invoke('task:remove', t.id).then(load));
      return el('li', { className: t.done ? 'done' : '' }, el('label', {}, box, el('span', { className: 'text', textContent: t.text })), del);
    }),
  );
  const pending = tasks.filter((t) => !t.done).length;
  $('tasks-hint').textContent =
    tasks.length === 0
      ? 'Anota lo que quieres terminar hoy. Las pendientes pasan al día siguiente.'
      : pending === 0
        ? '¡Todo listo por hoy!'
        : nudges
          ? `${pending} pendiente${pending === 1 ? '' : 's'}. Te las recuerdo cada 2 horas.`
          : `${pending} pendiente${pending === 1 ? '' : 's'}.`;
}

function render(v: DayView): void {
  document.title = v.name ? `Mi día con ${v.name}` : 'Mi día';
  $('title').textContent = document.title;
  $('date').textContent = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

  renderTasks(v.tasks, v.taskNudges);

  const stat = (value: string, label: string): HTMLElement => el('div', { className: 'stat' }, el('b', { textContent: value }), el('span', { textContent: label }));
  $('stats').replaceChildren(
    stat(hm(v.today.activeSec), 'frente al equipo'),
    stat(String(v.today.breaks), v.today.breaks === 1 ? 'pausa' : 'pausas'),
    stat(v.today.focusSessions ? `${v.today.focusSessions} · ${v.today.focusMin} min` : '0', 'sesiones de foco'),
    stat(String(v.today.water), v.today.water === 1 ? 'vaso de agua' : 'vasos de agua'),
    stat(String(v.today.tasksDone), v.today.tasksDone === 1 ? 'tarea hecha' : 'tareas hechas'),
    stat(String(v.today.pets), v.today.pets === 1 ? 'caricia' : 'caricias'),
  );

  const max = Math.max(3600, ...v.week.map((d) => d.activeSec));
  $('week').replaceChildren(
    ...v.week.map((d, i) => {
      const bar = el('i');
      bar.style.height = `${Math.max(3, (d.activeSec / max) * 88)}px`;
      const col = el('div', { className: i === v.week.length - 1 ? 'bar today' : 'bar', title: hm(d.activeSec) }, bar, weekday(d.day));
      col.setAttribute('aria-label', `${weekday(d.day)}: ${hm(d.activeSec)}`);
      return col;
    }),
  );
  $('streak').textContent =
    v.streak > 1 ? `🔥 ${v.streak} días seguidos usando el equipo.` : v.streak === 1 ? 'Racha: 1 día. ¡Vuelve mañana!' : 'Un día cuenta para la racha con 15 minutos frente al equipo.';

  const meter = (label: string, value: number, text: string): HTMLElement => {
    const fill = el('div', { className: 'fill' });
    fill.style.width = `${Math.round(value)}%`;
    const track = el('div', { className: 'track' }, fill);
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-valuenow', String(Math.round(value)));
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-label', label);
    return el('div', { className: 'meter' }, el('span', { textContent: label }), track, el('span', { className: 'muted', textContent: text }));
  };
  $('mood').replaceChildren(meter('Ánimo', v.mood.joy, v.mood.joyLabel), meter('Comida', v.mood.food, v.mood.foodLabel));

  const section = $('meetings-section');
  section.hidden = v.meetings === null;
  if (v.meetings) {
    const now = Date.now();
    $('meetings').replaceChildren(
      ...(v.meetings.length === 0
        ? [el('li', { className: 'muted', textContent: 'No hay más reuniones hoy.' })]
        : v.meetings.map((m) => el('li', { className: m.start < now ? 'past' : '' }, el('time', { textContent: clock(m.start) }), m.title))),
    );
  }
}

async function load(): Promise<void> {
  render(await panel().invoke<DayView>('day:get'));
}

$<HTMLFormElement>('add').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('new');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  void panel().invoke('task:add', text).then(load);
});

panel().on('day:changed', () => void load());
void load();
