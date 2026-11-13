/**
 * Detecta en macOS si hay una app en pantalla completa sobre la pantalla del
 * perro, para que se esconda solo (video, presentación, videollamada).
 *
 * No pide permisos: solo mira la posición y el tamaño de las ventanas, nunca
 * su contenido ni su título. La lectura la hace un script de `osascript`.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface WindowRect {
  /** Nivel de la ventana: 0 = ventana normal de una app, 24 = barra de menú. */
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MENU_BAR_LAYER = 24;
const TOLERANCE = 2;

/** Formato de cada línea del script: "capa,x,y,ancho,alto;capa,x,y,ancho,alto". */
export function parseWindows(line: string): WindowRect[] {
  const out: WindowRect[] = [];
  for (const part of line.split(';')) {
    const n = part.split(',').map(Number);
    if (n.length === 5 && n.every(Number.isFinite)) out.push({ layer: n[0], x: n[1], y: n[2], width: n[3], height: n[4] });
  }
  return out;
}

/**
 * ¿Hay algo en pantalla completa en esta pantalla?
 * Sí cuando una ventana normal ocupa todo el ancho, llega hasta abajo y empieza
 * donde iría la barra de menú (o más arriba), y además la barra de menú no está
 * a la vista. Una ventana solo maximizada deja la barra de menú visible.
 */
export function isFullscreen(windows: WindowRect[], display: Box, workArea: Box): boolean {
  const right = display.x + display.width;
  const bottom = display.y + display.height;
  const inside = (w: WindowRect): boolean => w.x >= display.x - TOLERANCE && w.x + w.width <= right + TOLERANCE;

  const menuBarShown = windows.some(
    (w) => w.layer === MENU_BAR_LAYER && inside(w) && Math.abs(w.y - display.y) <= TOLERANCE && w.width >= display.width * 0.9,
  );
  if (menuBarShown) return false;

  return windows.some(
    (w) =>
      w.layer === 0 &&
      inside(w) &&
      w.width >= display.width - TOLERANCE &&
      w.y <= workArea.y + TOLERANCE &&
      w.y + w.height >= bottom - TOLERANCE,
  );
}

/** Imprime por la salida de diagnóstico (así escribe `console.log` en osascript) una línea "FS:..." cuando algo cambia. */
const SCRIPT = `
ObjC.import('CoreGraphics');
function run() {
  var last = null;
  // Termina cada tanto y la app lo vuelve a lanzar: así nunca acumula memoria.
  for (var i = 0; i < 300; i++) {
    var info = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
    var parts = [];
    for (var j = 0; j < info.length; j++) {
      var w = info[j];
      var b = w.kCGWindowBounds;
      if (!b || (w.kCGWindowLayer !== 0 && w.kCGWindowLayer !== 24) || b.Width < 600) continue;
      parts.push([w.kCGWindowLayer, b.X, b.Y, b.Width, b.Height].join(','));
    }
    var line = parts.join(';');
    if (line !== last) { last = line; console.log('FS:' + line); }
    delay(2);
  }
}
`;

/**
 * Empieza a vigilar (solo macOS) y avisa con la lista de ventanas cada vez que cambia.
 * Devuelve una función para detenerlo.
 */
export function watchWindows(onChange: (windows: WindowRect[]) => void): () => void {
  if (process.platform !== 'darwin') return () => {};
  let child: ChildProcess | null = null;
  let stopped = false;
  let quickFailures = 0;

  const launch = (): void => {
    if (stopped) return;
    const startedAt = Date.now();
    let buffer = '';
    try {
      child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
      return;
    }
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('FS:')) onChange(parseWindows(line.slice(3)));
      }
    });
    child.on('error', () => {});
    child.on('exit', () => {
      child = null;
      // Si muere apenas arranca varias veces seguidas, no insiste: la función queda sin efecto.
      quickFailures = Date.now() - startedAt < 5000 ? quickFailures + 1 : 0;
      if (!stopped && quickFailures < 3) setTimeout(launch, 1000);
    });
  };

  launch();
  return () => {
    stopped = true;
    child?.kill();
  };
}
