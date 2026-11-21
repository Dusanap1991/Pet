/** Frases cortas para el saludo de la mañana (una por día, siempre la misma ese día). */
import { dayKey } from './store';

export const QUOTES = [
  'Paso a paso se llega lejos.',
  'Hecho es mejor que perfecto.',
  'Lo que hoy parece difícil, mañana será costumbre.',
  'Empieza por lo más pequeño: el resto viene solo.',
  'Descansar también es avanzar.',
  'Un buen día se arma con buenos ratos.',
  'No tienes que poder con todo hoy.',
  'La constancia le gana al talento que no se esfuerza.',
  'Una cosa a la vez, y bien hecha.',
  'Tómate un respiro: lo vas a hacer mejor.',
  'Las ideas llegan caminando.',
  'Hoy es un buen día para terminar algo pendiente.',
  'Celebra lo que ya avanzaste.',
  'Si te equivocas, aprendes. Si no lo intentas, no.',
  'El orden de hoy es la calma de mañana.',
  'Un vaso de agua y a seguir.',
  'Pedir ayuda también es trabajar bien.',
  'Lo importante primero; lo urgente, después de pensarlo.',
  'Cada tarea terminada es un peso menos.',
  'La paciencia también es productiva.',
  'Hoy, sé amable contigo.',
  'Las pausas cortas evitan los cansancios largos.',
  'Si algo toma menos de dos minutos, hazlo ahora.',
  'Mejor avanzar despacio que quedarse quieto.',
  'Tu mejor herramienta es una mente descansada.',
  'Respira hondo: no todo es para ya.',
  'Lo que se agenda, se hace.',
  'Termina el día anotando lo de mañana y duerme tranquilo.',
  'La energía se cuida como el tiempo.',
  'Hoy puede ser el día en que todo encaje.',
  'Un problema bien planteado ya está a medio resolver.',
  'Haz espacio para lo que te hace bien.',
  'El cansancio también avisa: escúchalo.',
  'Pequeños hábitos, grandes cambios.',
  'Mira lo lejos que has llegado.',
  'Concéntrate en lo que sí puedes cambiar.',
  'Sonreír también cuenta como pausa.',
  'Hoy tu perro cree en ti. 🐾',
];

export function quoteOfDay(now: number): string {
  const key = dayKey(now);
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return QUOTES[h % QUOTES.length];
}
