#!/usr/bin/env python3
"""
Convierte los videos del perro (fondo verde) en clips con transparencia para la app.

    python3 scripts/clips/process.py            # procesa todo lo que diga clips.json
    python3 scripts/clips/process.py quieto     # solo uno

Para cada clip:
  1. Quita el fondo verde (y la cinta de correr, si la hay) y le saca el reflejo verde al pelo.
  2. Estabiliza al perro (en la cinta se va corriendo de a poco).
  3. Si es un clip que se repite, busca el par de cuadros más parecidos para que el
     salto del final al principio no se note, y funde los últimos cuadros con los primeros.
  4. Recorta al perro, lo achica y lo guarda como WebM VP9 con transparencia en
     assets/dog/, junto a un manifest.json con el punto de apoyo y el tamaño.

Necesita ffmpeg (con libvpx-vp9), numpy y Pillow.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG = os.path.join(ROOT, 'scripts', 'clips', 'clips.json')
OUT_DIR = os.path.join(ROOT, 'assets', 'dog')

# Resolución de trabajo: los videos de 1280x720 se procesan a 960 px de ancho (nítido en pantallas Retina).
WORK_W = 960


def read_frames(src, start, end, fps):
    """Cuadros RGB (uint8) del tramo [start, end) del video, a WORK_W de ancho."""
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(',')
    w, h = int(probe[0]), int(probe[1])
    work_h = round(h * WORK_W / w / 2) * 2
    cmd = [
        'ffmpeg', '-v', 'error', '-ss', str(start), '-to', str(end), '-i', src,
        '-vf', f'fps={fps},scale={WORK_W}:{work_h}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(raw) // (WORK_W * work_h * 3)
    return np.frombuffer(raw[: n * WORK_W * work_h * 3], np.uint8).reshape(n, work_h, WORK_W, 3)


def key(frame, treadmill_top):
    """Alfa por cuadro: fuera el verde (fondo y piso) y, bajo la cinta, lo que no sea pata."""
    from PIL import ImageFilter
    f = frame.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    h, w = frame.shape[:2]
    k = w / 640.0
    gdom = g - np.maximum(r, b)
    alpha = np.clip((34.0 - gdom) / (34.0 - 8.0), 0, 1)
    if treadmill_top is not None:
        top = int(treadmill_top * h)
        # Dónde empieza la cinta en este cuadro: la primera fila (bajo la mitad) que es gris oscura
        # en buena parte del ancho. Así el corte calza aunque la cinta salga más arriba o más abajo.
        mx0, mn0 = f.max(axis=2), f.min(axis=2)
        dark = ((mx0 - mn0) < 28) & (mx0 < 95)
        frac = dark.mean(axis=1)
        rows_dark = np.nonzero(frac[h // 2:] > 0.35)[0]
        if len(rows_dark):
            top = h // 2 + int(rows_dark[0]) - int(2 * k)
        # En la zona de la cinta solo se quedan las patas: tonos café rojizos.
        brown = (r - np.maximum(g, b)) > 6
        rows = np.arange(h)[:, None] >= top
        alpha = np.where(rows & ~brown, 0, alpha)
        # Sobre la cinta solo pueden estar las patas: fuera de lo que queda bajo el cuerpo, todo afuera.
        above = alpha[max(0, top - int(50 * k)): top] > 0.5
        cols = np.nonzero(above.any(axis=0))[0]
        if len(cols):
            x0, x1 = max(0, cols.min() - int(22 * k)), min(w, cols.max() + int(22 * k))
            outside = np.ones(w, bool)
            outside[x0:x1] = False
            alpha[top:, outside] = 0
        # Las líneas finas (el borde de la cinta) se van con una "apertura": lo que mide 1-3 px desaparece.
        zone = slice(max(0, top - int(6 * k)), h)
        img = Image.fromarray((alpha[zone] * 255).astype(np.uint8), 'L')
        size = 5 if k > 1.2 else 3
        opened = np.asarray(img.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size)), np.float32) / 255
        alpha[zone] = np.minimum(alpha[zone], opened)

    # Borde suave (sin escalones).
    a_img = Image.fromarray((alpha * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.6 * k))
    alpha = np.minimum(alpha, np.asarray(a_img, np.float32) / 255 + 0.0) * 0.5 + np.asarray(a_img, np.float32) / 255 * 0.5

    # Descontaminar el borde: en los pixeles semitransparentes se resta el verde del fondo que se mezcló.
    bg_mask = alpha < 0.02
    bg = np.median(f[bg_mask], axis=0) if bg_mask.sum() > 100 else np.array([88, 142, 96], np.float32)
    a3 = np.clip(alpha, 0.12, 1)[..., None]
    edge = ((alpha > 0.02) & (alpha < 0.97))[..., None]
    fg = np.clip((f - (1 - a3) * bg) / a3, 0, 255)
    f = np.where(edge, fg, f)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    # Reflejo verde en el pelo: en el borde se elimina del todo, adentro casi.
    limit = np.where(alpha < 0.97, np.maximum(r, b), np.maximum(r, b) * 1.03 + 3)
    g = np.minimum(g, limit)
    # En el pelo café en sombra (panza, entre las patas) el rebote verde da un tono oliva: se lleva el
    # verde a la proporción normal del pelo. No toca lo gris o negro (nariz, ojos) ni lo rosado (lengua).
    brownish = (r - b) > 25
    g = np.where(brownish, np.minimum(g, r * 0.72 + 4), g)
    rgb = np.stack([r, g, b], axis=-1)
    # Retoque de color suave: un poco más de saturación y calidez (la pantalla verde apaga el colorado).
    lum = (rgb * np.array([0.299, 0.587, 0.114], np.float32)).sum(axis=-1, keepdims=True)
    rgb = lum + (rgb - lum) * 1.12
    rgb = (rgb - 128) * 1.04 + 128
    rgb[..., 0] *= 1.02
    rgb[..., 2] *= 0.97
    return np.clip(rgb, 0, 255), alpha


def connected(alpha):
    """Deja solo lo que está pegado al cuerpo del perro (relleno desde el centro del cuerpo)."""
    from PIL import ImageDraw, ImageFilter
    m = (alpha > 0.3).astype(np.uint8) * 255
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return alpha
    # Semilla: el pixel del perro más cercano al centro de su masa.
    cy, cx = ys.mean(), xs.mean()
    k = np.argmin((ys - cy) ** 2 + (xs - cx) ** 2)
    # .copy(): la imagen creada desde el arreglo comparte memoria de solo lectura y el relleno no se aplicaría.
    img = Image.fromarray(m, 'L').copy()
    ImageDraw.floodfill(img, (int(xs[k]), int(ys[k])), 128)
    keep = (np.asarray(img) == 128).astype(np.uint8) * 255
    # Un poco más ancho, para no comerse el borde suave del pelo.
    keep = np.asarray(Image.fromarray(keep, 'L').filter(ImageFilter.MaxFilter(7))) > 0
    return alpha * keep


def clean(alpha):
    """Quita motitas sueltas: se queda con la zona alrededor del cuerpo principal."""
    m = alpha > 0.5
    cols = m.sum(axis=0)
    rows = m.sum(axis=1)
    # Una columna cuenta si tiene algo de perro; la cola es fina (1-2 pixeles), así que basta con 1.
    keep_c = cols > 0
    keep_r = rows > 0
    if not keep_c.any() or not keep_r.any():
        return alpha
    x0, x1 = np.argmax(keep_c), len(keep_c) - np.argmax(keep_c[::-1])
    y0, y1 = np.argmax(keep_r), len(keep_r) - np.argmax(keep_r[::-1])
    out = np.zeros_like(alpha)
    out[max(0, y0 - 4): y1 + 4, max(0, x0 - 4): x1 + 4] = alpha[max(0, y0 - 4): y1 + 4, max(0, x0 - 4): x1 + 4]
    return out


MASK_CELL = 9


def write_mask(name, alphas):
    """Guarda en <clip>.mask.json la silueta de cada cuadro (en celdas de MASK_CELL px) y dónde
    están la cabeza (punto más alto) y la nariz (punto más adelantado de la mitad de arriba)."""
    import base64
    n, h, w = alphas.shape
    cols, rows = (w + MASK_CELL - 1) // MASK_CELL, (h + MASK_CELL - 1) // MASK_CELL
    frames, heads, noses, feet, spans = [], [], [], [], []
    for a in alphas:
        pad = np.zeros((rows * MASK_CELL, cols * MASK_CELL), np.float32)
        pad[:h, :w] = a
        cells = pad.reshape(rows, MASK_CELL, cols, MASK_CELL).mean(axis=(1, 3)) > 0.25
        frames.append(base64.b64encode(np.packbits(cells.flatten()).tobytes()).decode())
        ys, xs = np.nonzero(a > 0.5)
        if len(ys) == 0:
            heads.append([w / 2, 0]); noses.append([w, h / 2]); feet.append([]); spans.append([0, w]); continue
        top = ys.min()
        heads.append([float(np.median(xs[ys <= top + 6])), float(top)])
        # Patas apoyadas: columnas con perro en las filas más bajas (para la sombra de contacto).
        bottom = int(np.percentile(ys, 99.5))
        band = a[max(0, bottom - 8): bottom + 1] > 0.5
        fcols = np.nonzero(band.any(axis=0))[0]
        runs, start = [], None
        for c in range(len(fcols)):
            if start is None:
                start = fcols[c]
            if c == len(fcols) - 1 or fcols[c + 1] - fcols[c] > 3:
                runs.append([round(float((start + fcols[c]) / 2), 1), round(float(fcols[c] - start + 1), 1)])
                start = None
        feet.append(runs[:6])
        lows = xs[ys > top + (bottom - top) * 0.55]
        spans.append([round(float(lows.min()), 1), round(float(lows.max()), 1)] if len(lows) else [0, float(w)])
        upper = ys < top + (ys.max() - top) * 0.45
        k = np.argmax(np.where(upper, xs, -1))
        noses.append([float(xs[k]), float(ys[k])])
    with open(os.path.join(OUT_DIR, f'{name}.mask.json'), 'w') as fh:
        json.dump({'cell': MASK_CELL, 'cols': int(cols), 'rows': int(rows), 'frames': frames,
                   'head': [[round(x, 1), round(y, 1)] for x, y in heads],
                   'nose': [[round(x, 1), round(y, 1)] for x, y in noses],
                   'feet': feet, 'span': spans}, fh, separators=(',', ':'))


def smooth(values, win):
    k = np.ones(win) / win
    pad = np.pad(values, (win // 2, win - 1 - win // 2), mode='edge')
    return np.convolve(pad, k, mode='valid')


def best_loop(small, min_len, max_len):
    """Par (i, j) de cuadros más parecidos con min_len <= j - i <= max_len."""
    n = len(small)
    best = (0, n - 1, float('inf'))
    for i in range(0, max(1, n - min_len)):
        for j in range(i + min_len, min(n, i + max_len + 1)):
            d = float(np.mean(np.abs(small[i] - small[j])))
            if d < best[2]:
                best = (i, j, d)
    return best


def process(name, spec, fps):
    src = os.path.join(ROOT, spec['src'])
    print(f'· {name}: {spec["src"]} [{spec["start"]}s–{spec["end"]}s]')
    frames = read_frames(src, spec['start'], spec['end'], fps)
    h, w = frames.shape[1:3]
    rgbs, alphas = [], []
    for fr in frames:
        rgb, a = key(fr, spec.get('treadmillTop'))
        a = clean(connected(a))
        rgbs.append(rgb)
        alphas.append(a)
    rgbs = np.stack(rgbs)
    alphas = np.stack(alphas)
    if spec.get('reverse'):
        # Por ejemplo "levantarse" = "sentarse" al revés.
        rgbs, alphas, frames = rgbs[::-1].copy(), alphas[::-1].copy(), frames[::-1]

    # Punto de apoyo (base de las patas) y centro del cuerpo de cada cuadro.
    masks = alphas > 0.5
    bottoms, cx = [], []
    for m in masks:
        ys, xs = np.nonzero(m)
        bottoms.append(np.percentile(ys, 99.5) if len(ys) else h)
        cx.append(xs.mean() if len(xs) else w / 2)
    bottoms, cx = np.array(bottoms), np.array(cx)

    # Estabilizar: en la cinta el perro se corre de a poco; se quita esa deriva lenta.
    shift = np.zeros(len(frames))
    if spec.get('stabilize'):
        drift = smooth(cx, max(3, int(fps * 1.5)))
        shift = np.round(drift.mean() - drift).astype(int)
        for k in range(len(frames)):
            if shift[k]:
                rgbs[k] = np.roll(rgbs[k], shift[k], axis=1)
                alphas[k] = np.roll(alphas[k], shift[k], axis=1)

    # Velocidad del suelo (cinta): cuánto retroceden las patas apoyadas de un cuadro al siguiente.
    # Con eso el perro avanza en pantalla al mismo ritmo que sus patas y no "patina".
    ground_speed = None
    if spec.get('treadmillTop') is not None:
        moves = []
        prev = None
        for k in range(len(alphas)):
            m = alphas[k] > 0.5
            ys_, xs_ = np.nonzero(m)
            if len(ys_) == 0:
                prev = None
                continue
            bottom = int(np.percentile(ys_, 99.5))
            band = m[max(0, bottom - 5): bottom + 1].any(axis=0)
            cols = np.nonzero(band)[0]
            centers, start = [], None
            for c in range(len(cols)):
                if start is None:
                    start = cols[c]
                if c == len(cols) - 1 or cols[c + 1] - cols[c] > 3:
                    centers.append((start + cols[c]) / 2)
                    start = None
            if prev is not None:
                for c in centers:
                    d = min(prev, key=lambda q: abs(q - c)) if prev else None
                    if d is not None and abs(c - d) < 20 * WORK_W / 640:
                        moves.append(c - d)
            prev = centers
        if moves:
            back = [m for m in moves if m < -0.15]
            if len(back) > len(moves) * 0.25:
                ground_speed = float(-np.median(back) * fps)
        print(f'  velocidad de la cinta: {ground_speed and round(ground_speed)} px/s')

    # Repetición sin salto.
    kind = spec.get('kind', 'loop')
    if kind == 'loop':
        small = np.stack([
            np.asarray(Image.fromarray((np.dstack([rgbs[k], alphas[k][..., None] * 255])).astype(np.uint8)).resize((80, 45), Image.BILINEAR), np.float32)
            for k in range(len(frames))
        ])
        i, j, d = best_loop(small, int(spec.get('minLen', 3) * fps), int(spec.get('maxLen', 12) * fps))
        fade = min(int(fps * 0.4), i, j - i - 1)
        print(f'  repetición: cuadros {i}–{j} ({(j - i) / fps:.2f} s), diferencia {d:.1f}, fundido {fade}')
        rgbs_l = rgbs[i:j].copy()
        alphas_l = alphas[i:j].copy()
        for t in range(fade):
            k = len(rgbs_l) - fade + t
            mix = (t + 1) / (fade + 1)
            rgbs_l[k] = rgbs_l[k] * (1 - mix) + rgbs[i - fade + t] * mix
            alphas_l[k] = alphas_l[k] * (1 - mix) + alphas[i - fade + t] * mix
        rgbs, alphas = rgbs_l, alphas_l
        bottoms = bottoms[i:j]
    else:
        print(f'  una vez: {len(frames) / fps:.2f} s')

    # Recorte común con margen.
    union = (alphas > 0.08).any(axis=0)
    ys, xs = np.nonzero(union)
    m = 9
    x0, x1 = max(0, xs.min() - m), min(w, xs.max() + m)
    y0, y1 = max(0, ys.min() - m), min(h, ys.max() + m)
    x1 = x0 + (x1 - x0) // 2 * 2
    y1 = y0 + (y1 - y0) // 2 * 2

    ground = float(np.median(bottoms[: max(1, len(bottoms) // 4)])) if kind != 'loop' else float(np.median(bottoms))
    tmp = tempfile.mkdtemp(prefix=f'clip-{name}-')
    try:
        for k in range(len(rgbs)):
            rgba = np.dstack([np.clip(rgbs[k], 0, 255), np.clip(alphas[k] * 255, 0, 255)]).astype(np.uint8)
            # Pixeles transparentes en negro: evita bordes verdes al comprimir.
            rgba[..., :3][rgba[..., 3] < 8] = 0
            Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA').save(os.path.join(tmp, f'{k:04d}.png'))
        out = os.path.join(OUT_DIR, f'{name}.webm')
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-framerate', str(fps), '-i', os.path.join(tmp, '%04d.png'),
            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', str(spec.get('crf', 34)),
            '-row-mt', '1', '-auto-alt-ref', '0', '-an', out,
        ], check=True)
        # Primer cuadro como imagen, para mostrarlo al instante mientras carga el video.
        shutil.copy(os.path.join(tmp, '0000.png'), os.path.join(OUT_DIR, f'{name}.png'))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # Silueta por cuadro (para saber dónde se puede hacer clic) y puntos de la cabeza y la nariz.
    write_mask(name, alphas[:, y0:y1, x0:x1])

    size = os.path.getsize(os.path.join(OUT_DIR, f'{name}.webm'))
    print(f'  → assets/dog/{name}.webm  {x1 - x0}x{y1 - y0}, {len(rgbs)} cuadros, {size / 1024:.0f} KB')
    return {
        'file': f'{name}.webm',
        'poster': f'{name}.png',
        'width': int(x1 - x0),
        'height': int(y1 - y0),
        'frames': len(rgbs),
        'fps': fps,
        'loop': kind == 'loop',
        # Punto de apoyo dentro del recorte (base de las patas, centro del cuerpo).
        'anchorX': float(np.mean(cx) + shift.mean() - x0),
        'anchorY': ground - y0,
        # Pixeles del video por segundo que avanza el suelo bajo las patas (solo clips en cinta).
        'groundSpeed': ground_speed,
    }


def main():
    with open(CONFIG) as fh:
        config = json.load(fh)
    os.makedirs(OUT_DIR, exist_ok=True)
    only = set(sys.argv[1:])
    manifest_path = os.path.join(OUT_DIR, 'manifest.json')
    manifest = {'clips': {}}
    if os.path.exists(manifest_path):
        with open(manifest_path) as fh:
            manifest = json.load(fh)
    fps = config.get('fps', 24)
    for name, spec in config['clips'].items():
        if only and name not in only:
            continue
        manifest['clips'][name] = process(name, spec, fps)
    # Escala común: largo del perro (de la cola a la nariz) en pixeles del recorte del clip "quieto".
    manifest['dogLengthPx'] = config['dogLengthPx']
    manifest['workWidth'] = WORK_W
    with open(manifest_path, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print('manifest.json actualizado')


if __name__ == '__main__':
    main()
