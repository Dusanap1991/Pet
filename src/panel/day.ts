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
  waterGoal: number;
  moodScore: number;
  weekMood: number[];
  habits: { id: string; name: string; today: boolean; streak: number; week: boolean[] }[];
  achievements: { id: string; icon: string; title: string; hint: string; goal: number; progress: number; unlocked: boolean }[];
}

const MOODS = ['', '😞', '😕', '😐', '🙂', '😄'];
const MOOD_LABELS = ['', 'Muy mal', 'Mal', 'Normal', 'Bien', 'Muy bien'];

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

  const waterStat = (n: number, goal: number): HTMLElement => {
    const fill = el('i');
    fill.style.width = `${Math.min(100, (n / goal) * 100)}%`;
    const bar = el('div', { className: 'goal' }, fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(n));
    bar.setAttribute('aria-valuemax', String(goal));
    bar.setAttribute('aria-label', 'Meta de agua');
    return el('div', { className: 'stat' }, el('b', { textContent: `${n} / ${goal}` }), el('span', { textContent: n >= goal ? 'vasos · ¡meta cumplida!' : 'vasos de agua' }), bar);
  };
  const stat = (value: string, label: string): HTMLElement => el('div', { className: 'stat' }, el('b', { textContent: value }), el('span', { textContent: label }));
  $('stats').replaceChildren(
    stat(hm(v.today.activeSec), 'frente al equipo'),
    stat(String(v.today.breaks), v.today.breaks === 1 ? 'pausa' : 'pausas'),
    stat(v.today.focusSessions ? `${v.today.focusSessions} · ${v.today.focusMin} min` : '0', 'sesiones de foco'),
    waterStat(v.today.water, v.waterGoal),
    stat(String(v.today.tasksDone), v.today.tasksDone === 1 ? 'tarea hecha' : 'tareas hechas'),
    stat(String(v.today.pets), v.today.pets === 1 ? 'caricia' : 'caricias'),
  );

  const max = Math.max(3600, ...v.week.map((d) => d.activeSec));
  $('week').replaceChildren(
    ...v.week.map((d, i) => {
      const bar = el('i');
      bar.style.height = `${Math.max(3, (d.activeSec / max) * 88)}px`;
      const mood = el('span', { className: 'mood', textContent: MOODS[v.weekMood[i]] ?? '' });
      const col = el('div', { className: i === v.week.length - 1 ? 'bar today' : 'bar', title: hm(d.activeSec) }, mood, bar, weekday(d.day));
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

  // Hábitos
  $('habits').replaceChildren(
    ...(v.habits.length === 0
      ? [el('li', { className: 'muted', textContent: 'Agrega los hábitos que quieres mantener; los marcas cada día.' })]
      : v.habits.map((h) => {
          const box = el('input', { type: 'checkbox', checked: h.today });
          box.setAttribute('aria-label', `${h.name}: hecho hoy`);
          box.addEventListener('change', () => void panel().invoke('habit:toggle', h.id).then(load));
          const dots = el('span', { className: 'dots', title: 'Últimos 7 días' }, ...h.week.map((on) => el('i', { className: on ? 'on' : '' })));
          const del = el('button', { type: 'button', className: 'icon', textContent: '×', title: 'Borrar hábito' });
          del.setAttribute('aria-label', `Borrar "${h.name}"`);
          del.addEventListener('click', () => void panel().invoke('habit:remove', h.id).then(load));
          const streak = el('span', { className: 'streak', textContent: h.streak > 1 ? `🔥 ${h.streak}` : '' });
          return el('li', {}, box, el('span', { textContent: h.name }), el('span', {}, dots, streak), del);
        })),
  );

  // Ánimo del día
  $('moods').replaceChildren(
    ...[1, 2, 3, 4, 5].map((score) => {
      const b = el('button', { type: 'button', textContent: MOODS[score] });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v.moodScore === score));
      b.setAttribute('aria-label', MOOD_LABELS[score]);
      b.title = MOOD_LABELS[score];
      b.addEventListener('click', () => void panel().invoke('mood:set', score).then(load));
      return b;
    }),
  );

  const got = v.achievements.filter((a) => a.unlocked).length;
  $('medals').replaceChildren(
    ...[...v.achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked)).map((a) => {
      const progress = !a.unlocked && a.goal > 1 ? ` (${a.progress}/${a.goal})` : '';
      const li = el('li', { className: a.unlocked ? '' : 'locked', title: a.hint + progress },
        el('span', { className: 'icon', textContent: a.icon }),
        el('b', { textContent: a.title }),
        el('span', { textContent: a.unlocked ? a.hint : `${a.hint}${progress}` }));
      li.setAttribute('aria-label', `${a.title}: ${a.unlocked ? 'desbloqueado' : 'pendiente'}. ${a.hint}${progress}`);
      return li;
    }),
  );
  $('ach-count').textContent = `${got} de ${v.achievements.length} desbloqueados.`;

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

$<HTMLFormElement>('add-habit').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('new-habit');
  const name = input.value.trim();
  if (!name) return;
  input.value = '';
  void panel().invoke('habit:add', name).then(load);
});

panel().on('day:changed', () => void load());
void load();
