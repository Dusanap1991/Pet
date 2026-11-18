import { BufferAttribute, BufferGeometry, Mesh, Vector3, type Material } from 'three';

/** Color por vértice: recibe la normal (en el espacio del perro) y la posición en la superficie (u alrededor, v a lo largo). */
export type ColorFn = (nx: number, ny: number, nz: number, u: number, v: number, out: [number, number, number]) => void;

/**
 * Un tubo de sección elíptica que se rehace en cada cuadro siguiendo una línea
 * de centros. Sirve para el cuerpo, el cuello, las patas, el hocico y la cola.
 */
export class Tube {
  readonly mesh: Mesh;
  private readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly norm: Float32Array;
  private readonly tmpC: [number, number, number] = [0, 0, 0];

  constructor(private readonly rings: number, private readonly sides: number, material: Material, private colorFn: ColorFn) {
    const verts = rings * (sides + 1) + 2;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    this.norm = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const idx: number[] = [];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j <= sides; j++) {
        const k = i * (sides + 1) + j;
        uv[k * 2] = j / sides;
        uv[k * 2 + 1] = i / (rings - 1);
        if (i < rings - 1 && j < sides) {
          const a = k, b = k + sides + 1, c = k + 1, d = k + sides + 2;
          idx.push(a, b, c, c, b, d);
        }
      }
    }
    // Tapas: un vértice en cada punta.
    const s0 = rings * (sides + 1), s1 = s0 + 1;
    for (let j = 0; j < sides; j++) {
      idx.push(s0, j + 1, j);
      const base = (rings - 1) * (sides + 1);
      idx.push(s1, base + j, base + j + 1);
    }
    uv[s0 * 2 + 1] = 0;
    uv[s1 * 2 + 1] = 1;
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('normal', new BufferAttribute(this.norm, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('uv', new BufferAttribute(uv, 2));
    this.mesh = new Mesh(this.geo, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  setColorFn(fn: ColorFn): void {
    this.colorFn = fn;
  }

  /**
   * @param centers   `rings` puntos (x, y, z en el espacio del perro, y hacia arriba).
   * @param radii     `rings` pares [lateral, vertical].
   * @param ref       dirección que se toma como "arriba" de la sección (se proyecta perpendicular al tubo).
   */
  update(centers: Vector3[], radii: [number, number][], ref: Vector3): void {
    const { rings, sides, pos, col, norm } = this;
    const T = new Vector3(), N = new Vector3(), B = new Vector3(), p = new Vector3(), n = new Vector3();
    for (let i = 0; i < rings; i++) {
      const a = centers[Math.max(0, i - 1)], b = centers[Math.min(rings - 1, i + 1)];
      T.subVectors(b, a).normalize();
      N.copy(ref).addScaledVector(T, -ref.dot(T));
      if (N.lengthSq() < 1e-6) N.set(0, 0, 1).addScaledVector(T, -T.z);
      N.normalize();
      B.crossVectors(T, N);
      const [rx, ry] = radii[i];
      for (let j = 0; j <= sides; j++) {
        const phi = (j / sides) * Math.PI * 2;
        const c = Math.cos(phi), s = Math.sin(phi);
        p.copy(centers[i]).addScaledVector(N, c * ry).addScaledVector(B, s * rx);
        // Normal de la elipse.
        n.set(0, 0, 0).addScaledVector(N, c / Math.max(ry, 1e-3)).addScaledVector(B, s / Math.max(rx, 1e-3)).normalize();
        const k = (i * (sides + 1) + j) * 3;
        pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
        norm[k] = n.x; norm[k + 1] = n.y; norm[k + 2] = n.z;
        this.colorFn(n.x, n.y, n.z, j / sides, i / (rings - 1), this.tmpC);
        col[k] = this.tmpC[0]; col[k + 1] = this.tmpC[1]; col[k + 2] = this.tmpC[2];
      }
    }
    // Puntas.
    const ends: [number, number][] = [[rings * (sides + 1), 0], [rings * (sides + 1) + 1, rings - 1]];
    for (const [v, ring] of ends) {
      const c = centers[ring];
      const k = v * 3;
      pos[k] = c.x; pos[k + 1] = c.y; pos[k + 2] = c.z;
      const dir = new Vector3().subVectors(centers[ring], centers[ring === 0 ? 1 : rings - 2]).normalize();
      norm[k] = dir.x; norm[k + 1] = dir.y; norm[k + 2] = dir.z;
      const src = (ring * (sides + 1)) * 3;
      col[k] = col[src]; col[k + 1] = col[src + 1]; col[k + 2] = col[src + 2];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/** Puntos a lo largo de una curva suave (Catmull-Rom) que pasa por `ctrl`. */
export function sampleCurve(ctrl: Vector3[], n: number, out: Vector3[]): Vector3[] {
  const segs = ctrl.length - 1;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * segs;
    const s = Math.min(segs - 1, Math.floor(t));
    const f = t - s;
    const p0 = ctrl[Math.max(0, s - 1)], p1 = ctrl[s], p2 = ctrl[s + 1], p3 = ctrl[Math.min(segs, s + 2)];
    const f2 = f * f, f3 = f2 * f;
    const w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1, w2 = -1.5 * f3 + 2 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
    (out[i] ??= new Vector3()).set(
      p0.x * w0 + p1.x * w1 + p2.x * w2 + p3.x * w3,
      p0.y * w0 + p1.y * w1 + p2.y * w2 + p3.y * w3,
      p0.z * w0 + p1.z * w1 + p2.z * w2 + p3.z * w3,
    );
  }
  return out;
}
