import type { ReminderRequest } from '../main/reminders';

declare global {
  interface Window {
    reminderForm?: { add(request: ReminderRequest): void; close(): void };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = $<HTMLFormElement>('form');
const text = $<HTMLInputElement>('text');
const minutes = $<HTMLInputElement>('minutes');
const time = $<HTMLInputElement>('time');
const daily = $<HTMLInputElement>('daily');
const error = $<HTMLParagraphElement>('error');

const mode = (): 'in' | 'at' => (form.elements.namedItem('mode') as RadioNodeList).value as 'in' | 'at';
const setMode = (value: 'in' | 'at'): void => {
  (form.elements.namedItem('mode') as RadioNodeList).value = value;
  sync();
};

/** "Repetir todos los días" solo tiene sentido con una hora fija. */
function sync(): void {
  daily.disabled = mode() !== 'at';
  if (daily.disabled) daily.checked = false;
}

// Propone la próxima hora en punto.
const soon = new Date(Date.now() + 60 * 60_000);
time.value = `${String(soon.getHours()).padStart(2, '0')}:00`;

form.addEventListener('change', sync);
minutes.addEventListener('focus', () => setMode('in'));
time.addEventListener('focus', () => setMode('at'));
sync();

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = text.value.trim();
  if (!message) {
    error.textContent = 'Escribe qué quieres que te recuerde.';
    text.focus();
    return;
  }
  const request: ReminderRequest = { text: message, mode: mode() };
  if (request.mode === 'in') {
    const n = Number(minutes.value);
    if (!Number.isFinite(n) || n < 1 || n > 1440) {
      error.textContent = 'Los minutos van de 1 a 1440 (un día).';
      minutes.focus();
      return;
    }
    request.minutes = n;
  } else {
    if (!time.value) {
      error.textContent = 'Elige una hora.';
      time.focus();
      return;
    }
    request.time = time.value;
    request.daily = daily.checked;
  }
  window.reminderForm?.add(request);
});

$<HTMLButtonElement>('cancel').addEventListener('click', () => window.reminderForm?.close());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.reminderForm?.close();
});
