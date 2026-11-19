# Videos del perro

Aquí van los videos originales (fondo verde) con los que se arma el estilo
**Realista**. La herramienta `scripts/clips/process.py` les quita el fondo y la
cinta de correr, los estabiliza, busca dónde repetirlos sin salto y los guarda en
`assets/dog/` como WebM con transparencia.

## Agregar o cambiar un clip

1. Copia el video aquí con su nombre (por ejemplo `06-echarse.mp4`).
2. Agrégalo en `scripts/clips/clips.json`: qué tramo usar (`start`, `end` en
   segundos), si se repite (`"kind": "loop"`) o se ve una vez (`"once"`), y si
   tiene cinta de correr (`"treadmillTop": 0.8`, la altura donde empieza la cinta,
   y `"stabilize": true`).
3. Ejecuta:

```bash
python3 scripts/clips/process.py
```

Necesita `ffmpeg` (con libvpx-vp9), `numpy` y `Pillow`.

## Cómo pedir los videos

Imagen a video, con la foto de perfil del perro como imagen inicial, de 4 a 6
segundos y en 1080p. Prompt base (cambia `[ACCIÓN]`):

```
Photorealistic video of this exact red smooth-haired dachshund (same dog as the reference image), full body visible at all times with margin around it, side profile view facing right. [ACCIÓN] Static camera at the dog's eye level, no zoom, no camera movement, no cuts. Solid flat chroma-key green background (#00B140), evenly lit, no floor texture, no props, no other animals, no text. Soft even studio lighting, minimal shadows. Natural, realistic dog movement. The first and last frames show the same pose so the clip can loop seamlessly.
```

Clips que ya están: quieto, caminar, correr, sentarse (y levantarse, que es el
mismo al revés), sentado, echado, dormir y olfatear. Los que faltan, en orden de
utilidad: comer, feliz (cola), ladrar, echarse, bostezar, estirarse, sacudirse,
colgando del pellejo y sentado de frente.
