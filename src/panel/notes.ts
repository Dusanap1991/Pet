import { $, panel } from './panel';

const area = $<HTMLTextAreaElement>('notes');
const status = $<HTMLParagraphElement>('status');
let timer: number | undefined;

void panel().invoke<string>('notes:get').then((text) => {
  area.value = text ?? '';
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
});

function save(): void {
  clearTimeout(timer);
  timer = undefined;
  void panel().invoke<boolean>('notes:set', area.value).then((ok) => {
    status.textContent = ok ? 'Guardado.' : 'No se pudo guardar.';
  });
}

area.addEventListener('input', () => {
  status.textContent = 'Guardando…';
  clearTimeout(timer);
  timer = window.setTimeout(save, 600);
});
window.addEventListener('beforeunload', () => {
  if (timer !== undefined) save();
});
