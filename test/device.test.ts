import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceMonitor, type DeviceTick } from '../src/main/device';

const base: DeviceTick = { now: 0, enabled: true, away: false, online: true, battery: { level: 0.8, charging: false }, uptimeSec: 3600 };

test('batería: un aviso por umbral, se reinicia al enchufar', () => {
  const d = new DeviceMonitor();
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.3, charging: false } }), []);
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.19, charging: false } }), [{ kind: 'battery', percent: 19 }]);
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.18, charging: false } }), []);
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.09, charging: false } }), [{ kind: 'battery', percent: 9 }]);
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.09, charging: true } }), []);
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.15, charging: false } }), [{ kind: 'battery', percent: 15 }]);
  assert.deepEqual(d.tick({ ...base, battery: null }), []);
});

test('batería: si se abre ya muy baja avisa una vez, no tres', () => {
  const d = new DeviceMonitor();
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.04, charging: false } }), [{ kind: 'battery', percent: 4 }]);
  assert.deepEqual(d.tick({ ...base, battery: { level: 0.03, charging: false } }), []);
});

test('internet: avisa tras 45 s caído y cuando vuelve', () => {
  const d = new DeviceMonitor();
  assert.deepEqual(d.tick({ ...base, now: 0, online: false }), []);
  assert.deepEqual(d.tick({ ...base, now: 30_000, online: false }), []);
  assert.deepEqual(d.tick({ ...base, now: 46_000, online: false }), [{ kind: 'offline' }]);
  assert.deepEqual(d.tick({ ...base, now: 60_000, online: false }), []);
  assert.deepEqual(d.tick({ ...base, now: 70_000, online: true }), [{ kind: 'online' }]);
  assert.deepEqual(d.tick({ ...base, now: 80_000, online: false }), []);
  assert.deepEqual(d.tick({ ...base, now: 90_000, online: true }), [], 'corte corto: nada');
});

test('reinicio: una vez al día si lleva una semana encendido; nada si está apagado o no estás', () => {
  const d = new DeviceMonitor();
  const day = (n: number): number => new Date(2026, 0, n, 10).getTime();
  assert.deepEqual(d.tick({ ...base, now: day(1), uptimeSec: 8 * 86400, away: true }), []);
  assert.deepEqual(d.tick({ ...base, now: day(1), uptimeSec: 8 * 86400 }), [{ kind: 'restart', days: 8 }]);
  assert.deepEqual(d.tick({ ...base, now: day(1) + 3600_000, uptimeSec: 8 * 86400 }), []);
  assert.deepEqual(d.tick({ ...base, now: day(2), uptimeSec: 9 * 86400 }), [{ kind: 'restart', days: 9 }]);
  assert.deepEqual(new DeviceMonitor().tick({ ...base, enabled: false, uptimeSec: 9 * 86400, battery: { level: 0.1, charging: false } }), []);
});
