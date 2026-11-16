/** Disfraces de temporada. */
import type { Outfit } from './types';

export type { Outfit };

/** Zonas horarias del hemisferio sur (para saber cuándo es invierno). */
const SOUTH = /^(America\/(Santiago|Punta_Arenas|Argentina|Buenos_Aires|Montevideo|Asuncion|Sao_Paulo|La_Paz|Lima|Cuiaba|Campo_Grande|Porto_Velho|Recife|Bahia|Fortaleza|Belem|Maceio|Araguaina)|Australia|Antarctica|Pacific\/(Auckland|Chatham|Easter|Fiji|Noumea|Tongatapu)|Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka|Gaborone|Maseru|Mbabane|Luanda)|Indian\/(Mauritius|Reunion|Antananarivo))/;

export function isSouthern(timeZone: string, lat?: number | null): boolean {
  if (typeof lat === 'number') return lat < 0;
  return SOUTH.test(timeZone);
}

export function outfitFor(date: Date, south: boolean): Outfit {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 12 || (m === 1 && d <= 6)) return 'santa';
  if ((m === 10 && d >= 24) || (m === 11 && d <= 1)) return 'witch';
  const winter = south ? m >= 6 && m <= 8 : m === 1 || m === 2;
  return winter ? 'scarf' : null;
}
