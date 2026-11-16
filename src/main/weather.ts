/** Clima de la mañana con Open-Meteo (gratis, sin cuenta ni clave). */

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface DayForecast {
  min: number;
  max: number;
  /** Probabilidad máxima de lluvia del día, 0 a 100. */
  rain: number;
  /** Código WMO del tiempo del día. */
  code: number;
}

export const geocodeUrl = (city: string): string =>
  `https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&format=json&name=${encodeURIComponent(city.trim())}`;

export const forecastUrl = (p: Place): string =>
  `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}` +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1';

export function parsePlace(raw: unknown): Place | null {
  const r = (raw as { results?: unknown[] } | null)?.results?.[0] as Record<string, unknown> | undefined;
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number' || typeof r.name !== 'string') return null;
  const region = typeof r.admin1 === 'string' && r.admin1 !== r.name ? `, ${r.admin1}` : '';
  const country = typeof r.country === 'string' ? `, ${r.country}` : '';
  return { name: `${r.name}${region}${country}`, lat: r.latitude, lon: r.longitude };
}

export function parseForecast(raw: unknown): DayForecast | null {
  const d = (raw as { daily?: Record<string, unknown[]> } | null)?.daily;
  const pick = (key: string): number | null => {
    const v = d?.[key]?.[0];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const min = pick('temperature_2m_min');
  const max = pick('temperature_2m_max');
  const code = pick('weather_code');
  if (min === null || max === null || code === null) return null;
  return { min, max, code, rain: pick('precipitation_probability_max') ?? 0 };
}

function describe(code: number): [string, string] {
  if (code === 0) return ['☀️', 'despejado'];
  if (code <= 2) return ['🌤️', 'parcialmente nublado'];
  if (code === 3) return ['☁️', 'nublado'];
  if (code === 45 || code === 48) return ['🌫️', 'con niebla'];
  if (code >= 51 && code <= 57) return ['🌦️', 'con llovizna'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['🌧️', 'con lluvia'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['❄️', 'con nieve'];
  if (code >= 95) return ['⛈️', 'con tormenta'];
  return ['🌤️', 'variable'];
}

/** "🌧️ Hoy en Concepción: con lluvia, entre 9° y 14°. Lleva paraguas ☔" */
export function weatherMessage(placeName: string, f: DayForecast): string {
  const [icon, text] = describe(f.code);
  const city = placeName.split(',')[0];
  let tip = '';
  if (f.rain >= 50 || (f.code >= 61 && f.code <= 67) || (f.code >= 80 && f.code <= 82) || f.code >= 95) tip = ' Lleva paraguas ☔';
  else if (f.max >= 30) tip = ' Toma harta agua 💧';
  else if (f.min <= 3) tip = ' Abrígate bien 🧣';
  return `${icon} Hoy en ${city}: ${text}, entre ${Math.round(f.min)}° y ${Math.round(f.max)}°.${tip}`;
}
