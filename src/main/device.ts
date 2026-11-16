/** Avisos sobre el equipo: batería baja, internet caído y muchos días sin reiniciar. */
import { dayKey } from './store';

export interface DeviceTick {
  now: number;
  enabled: boolean;
  away: boolean;
  online: boolean;
  /** null si el equipo no tiene batería o no se sabe. */
  battery: { level: number; charging: boolean } | null;
  uptimeSec: number;
}

export type DeviceAlert =
  | { kind: 'battery'; percent: number }
  | { kind: 'offline' }
  | { kind: 'online' }
  | { kind: 'restart'; days: number };

const BATTERY_STEPS = [0.2, 0.1, 0.05];
/** Internet tiene que estar caído este tiempo antes de avisar (los cortes de segundos no importan). */
const OFFLINE_GRACE_MS = 45_000;
const RESTART_AFTER_DAYS = 7;

export class DeviceMonitor {
  /** Umbral de batería más bajo ya avisado (1 = ninguno). */
  private batteryWarned = 1;
  private offlineSince: number | null = null;
  private offlineWarned = false;
  private restartDay = '';

  tick(t: DeviceTick): DeviceAlert[] {
    const out: DeviceAlert[] = [];

    // Batería: un aviso por umbral; se reinicia al enchufar.
    if (!t.battery || t.battery.charging) {
      this.batteryWarned = 1;
    } else if (t.enabled && !t.away) {
      const step = BATTERY_STEPS.find((s) => t.battery!.level <= s && s < this.batteryWarned);
      if (step !== undefined) {
        this.batteryWarned = BATTERY_STEPS.filter((s) => t.battery!.level <= s).pop() ?? step;
        out.push({ kind: 'battery', percent: Math.round(t.battery.level * 100) });
      }
    }

    // Internet.
    if (!t.online) {
      this.offlineSince ??= t.now;
      if (t.enabled && !t.away && !this.offlineWarned && t.now - this.offlineSince >= OFFLINE_GRACE_MS) {
        this.offlineWarned = true;
        out.push({ kind: 'offline' });
      }
    } else {
      if (this.offlineWarned && t.enabled && !t.away) out.push({ kind: 'online' });
      this.offlineSince = null;
      this.offlineWarned = false;
    }

    // Reinicio: una sugerencia por día, si lleva una semana o más encendido.
    const days = Math.floor(t.uptimeSec / 86_400);
    const today = dayKey(t.now);
    if (t.enabled && !t.away && days >= RESTART_AFTER_DAYS && this.restartDay !== today) {
      this.restartDay = today;
      out.push({ kind: 'restart', days });
    }

    return out;
  }
}
