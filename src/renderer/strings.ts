/** Textos que dice el perro. Están juntos para poder traducirlos después. */
export const STR = {
  welcomeBack: '¡Volviste! Te extrañé',
  breakDue: (min: number): string => `Llevamos ${min} min seguidos. ¿Estiramos las patas?`,
  focusStart: (min: number): string => `¡A concentrarse! Te aviso en ${min} min.`,
  focusEnd: (min: number): string => `¡Listo! ${min} min de foco. Ahora toca un descanso.`,
};
