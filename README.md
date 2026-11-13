# Pet

Un perro salchicha que vive en tu escritorio. Camina por el borde inferior de la
pantalla, se sienta, olfatea, duerme la siesta y reacciona a lo que haces.
Para Windows y macOS.

## Qué hace

- **Vive encima de tus ventanas** sin estorbar: los clics pasan de largo salvo
  cuando el cursor está sobre el perro.
- **Se deja acariciar**: haz clic sobre él o pásale el cursor de un lado a otro.
- **Se deja levantar**: arrástralo hacia arriba y queda colgando del pellejo, de frente; suéltalo y cae sentado, se sacude el susto y sale caminando.
- **Varias pantallas**: llévalo arrastrando de una pantalla a otra, o elige la
  pantalla desde el menú de la bandeja.
- **Come premios**: desde el ícono de la bandeja, "Dar un premio" deja caer un
  hueso y el perro corre a buscarlo.
- **Te acompaña**: si dejas de usar el equipo un par de minutos se echa a dormir,
  y te recibe cuando vuelves.
- **Te cuida**: avisa cuando llevas mucho rato sin parar (50 minutos por defecto).
- **Sesiones de foco**: elige 15, 25 o 45 minutos; se queda echado y tranquilo, y
  ladra cuando se cumple el tiempo.

Todo se controla desde el ícono del perro en la bandeja del sistema (Windows) o
en la barra de menú (macOS): mostrar u ocultar, premios, foco, avisos, tamaño y
abrir al iniciar sesión.

## Privacidad

La única señal que lee del sistema es **cuántos segundos llevas sin tocar teclado
o mouse** (para saber si te fuiste) y la posición del cursor (para saber si está
sobre el perro). No registra teclas, no pide permisos de accesibilidad ni de
grabación de pantalla. Solo se conecta a internet para consultar en GitHub si hay
una versión nueva.

## Instalar

Descarga el instalador desde la [última release](https://github.com/Dusanap1991/Pet/releases/latest):
`arm64.dmg` para Mac con Apple silicon, `x64.dmg` para Mac Intel o `.exe` para Windows.

Los instaladores no están firmados, así que el sistema avisa la primera vez:

- **Windows**: en el aviso de SmartScreen, "Más información" → "Ejecutar de todas formas".
- **macOS**: abre la app una vez y luego ve a Ajustes del Sistema → Privacidad y
  seguridad → "Abrir de todos modos".

## Actualizaciones

Una vez instalada, la app se actualiza sola: al abrir (y cada 6 horas) consulta la
última release del repo, baja el código nuevo y avisa. Se aplica al reiniciar,
desde el menú de la bandeja ("Reiniciar para actualizar"). No reinstala nada: solo
cambia el código del perro, por eso funciona aunque la app no esté firmada.

Solo hay que volver a instalar si cambia la base de la app (la versión de
Electron o `src/main/boot.ts`); en ese caso se sube `SHELL_VERSION` en
`src/main/updater.ts` y las apps antiguas ignoran las actualizaciones nuevas.

Para publicar una versión: pestaña **Actions** → **Build** → **Run workflow**.

## Desarrollo

Necesitas Node.js 22 o superior.

```bash
npm install
```

```bash
npm start
```

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm run web` | Vista previa en el navegador (`http://localhost:5173`) con un escritorio falso y botones para disparar cada reacción. No necesita Electron. |
| `npm test` | Pruebas de la lógica de actividad, foco y configuración. |
| `npm run typecheck` | Chequeo de tipos. |
| `npm run dist` | Genera el instalador para el sistema en el que estás (queda en `release/`). |
| `npm run icons` | Regenera los íconos a partir del dibujo del perro (necesita Playwright instalado en la máquina). |

## Cómo está hecho

Electron + TypeScript, sin dependencias en tiempo de ejecución.

```
src/
  main/        Proceso principal: ventana transparente, bandeja, reloj de actividad y foco
  preload/     Puente mínimo entre el proceso principal y la ventana
  renderer/    El perro: dibujo, animación y comportamiento (web pura)
    dog/pose.ts   Poses como puntos clave (parado, sentado, echado, dormido)
    dog/draw.ts   Dibujo del perro en canvas a partir de una pose
    dog/dog.ts    Máquina de estados: qué hace y cuándo
  shared/      Tipos de los mensajes entre procesos
```

El perro no usa imágenes: se dibuja por código a partir de una pose, y las
animaciones salen de interpolar poses. Por eso se ve nítido a cualquier tamaño y
agregar un movimiento nuevo es agregar una pose.

La parte del perro es web pura y no conoce Electron: recibe eventos (`away`,
`back`, `treat`, `break-due`...) y avisa cuándo quiere recibir clics. Eso permite
verla en el navegador con `npm run web` y, si algún día conviene, cambiar
Electron por otra envoltura sin tocar al perro.

## Estado

Primera versión. Está probada en Linux (la app completa en un display virtual) y
en navegador; **falta probarla en Windows y macOS reales**, que es donde las
ventanas transparentes y siempre visibles tienen sus mañas.
