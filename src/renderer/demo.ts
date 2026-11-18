import type { PetEvent } from '../shared/types';

/** Alto de la barra de tareas falsa de la vista previa. */
export const DEMO_TASKBAR = 48;

/**
 * Vista previa en un navegador común, sin Electron: un escritorio falso y
 * botones para disparar los mismos eventos que manda la app de verdad.
 */
export function setupDemo(emit: (e: PetEvent) => void): void {
  document.body.classList.add('demo');

  const bar = document.createElement('div');
  bar.className = 'demo-taskbar';
  document.body.appendChild(bar);

  const panel = document.createElement('div');
  panel.className = 'demo-panel';
  const title = document.createElement('strong');
  title.textContent = 'Vista previa: clic para acariciar, arrastra para levantarlo';
  panel.appendChild(title);

  const add = (label: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    panel.appendChild(b);
  };

  add('Dar un premio', () => emit({ type: 'treat' }));
  add('Me fui (duerme)', () => emit({ type: 'away' }));
  add('Volví', () => emit({ type: 'back', awaySec: 600 }));
  add('Aviso de descanso', () => emit({ type: 'break-due', minutes: 50 }));
  add('Aviso de agua', () => emit({ type: 'water' }));
  add('Recordatorio', () => emit({ type: 'reminder', text: 'Llamar a Ana' }));
  add('Empezar foco', () => emit({ type: 'focus-start', minutes: 25 }));
  add('Terminar foco', () => emit({ type: 'focus-end', completed: true, minutes: 25 }));
  let ball = false;
  add('Pelota', () => emit({ type: 'ball', out: (ball = !ball) }));
  add('Triste', () => emit({ type: 'mood', joy: 10, food: 10 }));
  add('Feliz', () => emit({ type: 'mood', joy: 90, food: 90 }));
  add('Tareas', () => emit({ type: 'notice', text: '¡Buen día! Para hoy tienes 2:\n• Enviar informe\n• Llamar a Ana' }));
  const look = { size: 'm' as const, sound: false, name: '', style: '2d' as '2d' | '3d' | 'photo' };
  const styles = ['2d', 'photo', '3d'] as const;
  add('Estilo: dibujo / realista / 3D', () => {
    look.style = styles[(styles.indexOf(look.style) + 1) % styles.length];
    emit({ type: 'settings', ...look, coat: 'red', outfit: null });
  });
  add('Navidad', () => emit({ type: 'settings', ...look, coat: 'red', outfit: 'santa' }));
  add('Halloween', () => emit({ type: 'settings', ...look, coat: 'blacktan', outfit: 'witch' }));
  add('Bufanda', () => emit({ type: 'settings', ...look, coat: 'dapple', outfit: 'scarf' }));
  add('Sin disfraz', () => emit({ type: 'settings', ...look, coat: 'red', outfit: null }));
  add('Vista 20-20-20', () => emit({ type: 'eyes' }));
  add('Fondo claro/oscuro', () => document.body.classList.toggle('dark'));

  document.body.appendChild(panel);
}
