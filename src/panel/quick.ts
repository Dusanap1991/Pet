import { $, panel } from './panel';

const input = $<HTMLInputElement>('text');
$<HTMLFormElement>('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (input.value.trim()) void panel().invoke('quick:add', input.value);
});
window.addEventListener('focus', () => input.focus());
input.focus();
