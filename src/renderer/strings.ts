/** Textos que dice el perro. Están juntos para poder traducirlos después. */
export const STR = {
  welcomeBack: '¡Volviste! Te extrañé',
  breakDue: (min: number): string => `Llevamos ${min} min seguidos. ¿Estiramos? Haz clic en mí y te guío 2 min.`,
  focusStart: (min: number): string => `¡A concentrarse! Te aviso en ${min} min.`,
  water: [
    '¡Hora de tomar agua! 💧',
    'Un vasito de agua, ¿sí? 💧',
    'Yo ya tomé agua. ¿Y tú? 💧',
    'Pausa para hidratarse 💧',
    '¿Hace cuánto no tomas agua? 💧',
  ],
  stretchSteps: [
    ['Ponte de pie y respira hondo', 15],
    ['Gira los hombros hacia atrás, despacio', 20],
    ['Inclina la cabeza a cada lado', 20],
    ['Estira los brazos hacia arriba', 20],
    ['Junta las manos al frente y estira la espalda', 20],
    ['Mira algo lejano y relaja la vista', 15],
  ] as [string, number][],
  stretchDone: '¡Listo! Te ves más despierto 💪',
  stretchStop: 'Lo dejamos aquí. ¡Cuando quieras seguimos!',
  breatheDone: 'Listo. ¿Más tranquilo? 🌿',
  focusEnd: (min: number): string => `¡Listo! ${min} min de foco. Ahora toca un descanso.`,
};
