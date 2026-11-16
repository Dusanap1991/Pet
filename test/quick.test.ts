import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuick } from '../src/main/quick';

const now = new Date(2026, 0, 15, 10, 0).getTime();
const at = (h: number, m: number, d = 15): number => new Date(2026, 0, d, h, m).getTime();

test('sin "cuándo" es una tarea', () => {
  assert.deepEqual(parseQuick('  Enviar   informe ', now), { kind: 'task', text: 'Enviar informe' });
  assert.deepEqual(parseQuick('en la tarde revisar correo', now), { kind: 'task', text: 'en la tarde revisar correo' });
  assert.equal(parseQuick('   ', now), null);
});

test('"en N minutos/horas" es un recordatorio', () => {
  assert.deepEqual(parseQuick('en 20 min llamar a Ana', now), { kind: 'reminder', text: 'llamar a Ana', at: now + 20 * 60_000 });
  assert.deepEqual(parseQuick('En 1 hora: sacar la ropa', now), { kind: 'reminder', text: 'sacar la ropa', at: now + 60 * 60_000 });
  assert.deepEqual(parseQuick('en 5 minutos té', now), { kind: 'reminder', text: 'té', at: now + 5 * 60_000 });
});

test('"a las HH:MM" es un recordatorio hoy o mañana', () => {
  assert.deepEqual(parseQuick('a las 16:30 remedio', now), { kind: 'reminder', text: 'remedio', at: at(16, 30) });
  assert.deepEqual(parseQuick('a las 9 reunión', now), { kind: 'reminder', text: 'reunión', at: at(9, 0, 16) });
  assert.deepEqual(parseQuick('a la 1 almuerzo', now), { kind: 'reminder', text: 'almuerzo', at: at(1, 0, 16) });
  assert.deepEqual(parseQuick('a las 25:00 nada', now), { kind: 'task', text: 'a las 25:00 nada' });
});
