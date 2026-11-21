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
const repeat = $<HTMLSelectElement>('repeat');
const weekday = $<HTMLSelectElement>('weekday');
const date = $<HTMLInputElement>('date');
const dateTime = $<HTMLInputElement>('dateTime');
const yearly = $<HTMLInputElement>('yearly');
const error = $<HTMLParagraphElement>('error');

type Mode = 'in' | 'at' | 'date';
const mode = (): Mode => (form.elements.namedItem('mode') as RadioNodeList).value as Mode;
const setMode = (value: Mode): void => {
  (form.elements.namedItem('mode') as RadioNodeList).value = value;
  sync();
};

/** Cada opción de repetir solo tiene sentido con su modo. */
function sync(): void {
  repeat.disabled = mode() !== 'at';
  weekday.hidden = repeat.value !== 'weekly';
  weekday.disabled = repeat.disabled;
  yearly.disabled = mode() !== 'date';
  if (yearly.disabled) yearly.checked = false;
}

// Propone la próxima hora en punto.
const soon = new Date(Date.now() + 60 * 60_000);
time.value = `${String(soon.getHours()).padStart(2, '0')}:00`;

form.addEventListener('change', sync);
minutes.addEventListener('focus', () => setMode('in'));
time.addEventListener('focus', () => setMode('at'));
repeat.addEventListener('focus', () => setMode('at'));
date.addEventListener('focus', () => setMode('date'));
dateTime.addEventListener('focus', () => setMode('date'));
weekday.value = String(new Date().getDay());
date.value = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
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
  } else if (request.mode === 'at') {
    if (!time.value) {
      error.textContent = 'Elige una hora.';
      time.focus();
      return;
    }
    request.time = time.value;
    request.repeat = repeat.value as ReminderRequest['repeat'];
    if (request.repeat === 'weekly') request.weekday = Number(weekday.value);
  } else {
    if (!date.value || !dateTime.value) {
      error.textContent = 'Elige el día y la hora.';
      date.focus();
      return;
    }
    request.date = date.value;
    request.time = dateTime.value;
    request.yearly = yearly.checked;
  }
  window.reminderForm?.add(request);
});

$<HTMLButtonElement>('cancel').addEventListener('click', () => window.reminderForm?.close());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.reminderForm?.close();
});
