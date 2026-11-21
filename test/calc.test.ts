import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calc, formatNumber, looksLikeMath } from '../src/main/calc';
import { CountdownStore, daysUntil, together } from '../src/main/countdowns';
import { obeyChance, trainingLevel } from '../src/main/training';
import { parseQuick } from '../src/main/quick';

test('calculadora', () => {
  assert.equal(calc('= 12*8'), 96);
  assert.equal(calc('12 x 8'), 96);
  assert.equal(calc('(3+4)/2'), 3.5);
  assert.equal(calc('2^10'), 1024);
  assert.equal(calc('15% de 2300'), 345);
  assert.equal(calc('cuánto es 1,5 + 2,25?'), 3.75);
  assert.equal(calc('10 - -2'), 12);
  assert.equal(calc('2+'), null);
  assert.equal(calc('alert(1)'), null);
  assert.equal(formatNumber(1234567.891), '1.234.567,89');
  assert.equal(looksLikeMath('= 3'), true);
  assert.equal(looksLikeMath('12*8'), true);
  assert.equal(looksLikeMath('15% de 2300'), true);
  assert.equal(looksLikeMath('Comprar 2 kilos de pan'), false);
  assert.equal(looksLikeMath('2026'), false);
});

test('la nota rápida reconoce cuentas', () => {
  assert.deepEqual(parseQuick('= 12*8', 0), { kind: 'calc', text: '12*8', result: 96 });
  assert.equal(parseQuick('Enviar informe', 0)?.kind, 'task');
});

test('cuentas regresivas y aniversarios', () => {
  const now = new Date(2026, 0, 10, 15).getTime();
  assert.equal(daysUntil('2026-01-22', now), 12);
  assert.equal(daysUntil('2026-01-10', now), 0);
  const store = new CountdownStore();
  assert.equal(store.add('Pasado', '2026-01-01', now), null);
  store.add('Vacaciones', '2026-01-22', now);
  store.add('Reunión', '2026-01-11', now);
  assert.deepEqual(store.list(now).map((c) => c.name), ['Reunión', 'Vacaciones']);
  assert.deepEqual(store.todayNotices(now), ['⏳ Mañana: Reunión']);
  assert.deepEqual(store.todayNotices(new Date(2026, 0, 22, 9).getTime()), ['🎉 ¡Hoy es Vacaciones!']);
  assert.equal(store.list(new Date(2026, 0, 25).getTime()).length, 0, 'las pasadas se borran');
  assert.deepEqual(together('2026-01-03', now), { days: 7, milestone: '¡Hoy cumplimos una semana juntos! 🎂' });
  assert.equal(together('2026-01-04', now).milestone, null);
});

test('entrenamiento', () => {
  assert.equal(obeyChance(0), 0.55);
  assert.equal(Math.round(obeyChance(30) * 100), 97);
  assert.equal(trainingLevel(0).label, 'Cachorro');
  assert.equal(trainingLevel(20).label, 'Obediente');
  assert.equal(trainingLevel(40).label, 'Experto');
});
