/**
 * El perro en 3D (Three.js). Se arma con las mismas poses que el dibujo 2D:
 * cada cuadro recibe los puntos clave (cadera, pecho, cabeza, patas…) y
 * rehace el cuerpo, el cuello, las patas, el hocico y la cola como tubos con
 * volumen. Así conserva todas las animaciones y gracias que ya existen.
 *
 * Coordenadas: las poses usan x hacia adelante e y hacia abajo; aquí y va
 * hacia arriba (por eso se invierte) y z es el costado (positivo hacia la cámara).
 */
import {
  CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, PCFShadowMap, PlaneGeometry, PMREMGenerator,
  Matrix4, Quaternion, RepeatWrapping, Scene, ShadowMaterial, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3,
  WebGLRenderer, ACESFilmicToneMapping, MeshBasicMaterial, BufferAttribute, type BufferGeometry,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Pose } from '../dog/pose';
import { Tube, sampleCurve, type ColorFn } from './tube';

export type Outfit3D = 'santa' | 'witch' | 'scarf' | null;

/** Lo que el perro le pasa al renderizador en cada cuadro. */
export interface View3D {
  pose: Pose;
  breath: number;
  wag: number;
  wagLag: number;
  /** Giro sobre el eje vertical: 0 = mira a la derecha, -π/2 = mira a la cámara, -π = mira a la izquierda. */
  yaw: number;
  /** Inclinación (radianes, positiva = cabeza arriba) alrededor de `pivot`, en coordenadas de la pose. */
  tilt: number;
  pivotX: number;
  pivotY: number;
  /** Corrimiento horizontal (unidades del perro) para que el punto agarrado quede bajo el cursor. */
  offsetX: number;
  squash: number;
  /** Altura sobre el suelo, en unidades del perro. */
  lift: number;
}

interface Coat3D {
  fur: string;
  dark: string;
  light: string;
  points?: string;
  spots?: string;
  ear: string;
  nose: string;
  iris: string;
}

/** Colores pensados para verse naturales con luz (más profundos que los del dibujo plano). */
export const COATS_3D: Record<string, Coat3D> = {
  red: { fur: '#99401A', dark: '#561E09', light: '#C9783F', ear: '#77300F', nose: '#1B1310', iris: '#4E240D' },
  blacktan: { fur: '#231C18', dark: '#0E0B09', light: '#4A3A30', points: '#B06A30', ear: '#1A1411', nose: '#0E0B0A', iris: '#3A2010' },
  chocolate: { fur: '#5E3520', dark: '#341A0D', light: '#93613F', points: '#A8703F', ear: '#4A2816', nose: '#3A2418', iris: '#6A4A1E' },
  cream: { fur: '#E2BE8E', dark: '#B38658', light: '#F6E2C2', ear: '#C99D6C', nose: '#3A2A20', iris: '#5A3A18' },
  dapple: { fur: '#8C8782', dark: '#55504C', light: '#C9C2BA', spots: '#2E2926', points: '#AD7442', ear: '#5E5854', nose: '#1A1715', iris: '#4A3020' },
};

const v3 = (x: number, y: number, z = 0): Vector3 => new Vector3(x, -y, z);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Interpola un perfil de llaves [t, ...valores]. */
function profile(keys: number[][], t: number): number[] {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const k = smooth(keys[i - 1][0], keys[i][0], t);
      return keys[i].slice(1).map((v, j) => lerp(keys[i - 1][j + 1], v, k));
    }
  }
  return keys[keys.length - 1].slice(1);
}

/** Ruido de valor 2D para las manchas del arlequín (fijo sobre la piel, no se mueve con la pose). */
function spotNoise(u: number, v: number, seed: number): number {
  const hash = (x: number, y: number): number => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const x = u * 7, y = v * 11;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi % 7, yi), b = hash((xi + 1) % 7, yi), c = hash(xi % 7, yi + 1), d = hash((xi + 1) % 7, yi + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

/** Textura de normales con pelitos cortos en una dirección: da el brillo "peinado" del pelo corto. */
function hairNormalMap(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size, y = rnd() * size, len = 6 + rnd() * 10, tilt = (rnd() - 0.5) * 0.5;
    const shade = 128 + (rnd() - 0.5) * 70;
    g.strokeStyle = `rgb(${shade | 0},${(128 + (rnd() - 0.5) * 30) | 0},255)`;
    g.lineWidth = 0.7 + rnd() * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + tilt * len, y + len);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(4, 9);
  return t;
}

function radialShadow(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function stripeTexture(a: string, b: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 8);
  g.fillStyle = b;
  for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 6, 8);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

/** 2 huesos (muslo y pierna, o brazo y antebrazo): dónde queda la articulación del medio. */
function knee(j: Vector2, w: Vector2, l1: number, l2: number, forward: boolean): Vector2 {
  const d = Math.min(Math.max(j.distanceTo(w), Math.abs(l1 - l2) + 0.1), (l1 + l2) * 0.999);
  const u = new Vector2().subVectors(w, j).normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = new Vector2().copy(j).addScaledVector(u, a);
  const c1 = new Vector2(p.x - u.y * h, p.y + u.x * h);
  const c2 = new Vector2(p.x + u.y * h, p.y - u.x * h);
  return (forward ? c1.x > c2.x : c1.x < c2.x) ? c1 : c2;
}

export class Dog3D {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  private readonly root = new Group();
  private readonly tiltGroup = new Group();
  private readonly body = new Group();
  private readonly floor = new Group();
  private readonly contact: Mesh;

  private coat: Coat3D = COATS_3D.red;
  private outfit: Outfit3D = null;

  private readonly fur: MeshPhysicalMaterial;
  private readonly earMat: MeshPhysicalMaterial;
  private readonly pointsMat: MeshPhysicalMaterial;

  private readonly torso: Tube;
  private readonly neck: Tube;
  private readonly muzzle: Tube;
  private readonly jaw: Tube;
  private readonly tongue: Tube;
  private readonly tail: Tube;
  private readonly scruff: Tube;
  private readonly legs: Tube[] = [];
  private readonly paws: Group[] = [];
  private readonly thighs: Mesh[] = [];
  private readonly shoulders: Mesh[] = [];
  private readonly skull: Mesh;
  private readonly cheeks: Mesh;
  private readonly nose: Mesh;
  private readonly mouthInside: Mesh;
  private readonly eyes: Group[] = [];
  private readonly brows: Mesh[] = [];
  private readonly ears: Group[] = [];
  private readonly collar: Mesh;
  private readonly tag: Mesh;
  private readonly hats: Record<'santa' | 'witch', Group>;
  private readonly scarf: Group;

  private readonly buf: Record<string, Vector3[]> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    // Luz principal cálida desde arriba a la izquierda, relleno de cielo y un contraluz que separa la silueta del fondo.
    const key = new DirectionalLight(0xfff0dc, 2.0);
    key.position.set(-50, 260, 150);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -170;
    key.shadow.camera.right = 170;
    key.shadow.camera.top = 170;
    key.shadow.camera.bottom = -170;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 700;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.6;
    this.scene.add(key, key.target);
    const rim = new DirectionalLight(0xfff6ec, 1.1);
    rim.position.set(120, 90, -160);
    this.scene.add(rim);
    this.scene.add(new HemisphereLight(0xfff6ea, 0x5a4434, 0.55));

    // Suelo invisible que solo recibe la sombra, más una sombra de contacto suave.
    const ground = new Mesh(new PlaneGeometry(700, 400), new ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.contact = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: radialShadow(), transparent: true, depthWrite: false }));
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.2;
    this.floor.add(ground, this.contact);
    this.scene.add(this.floor);

    this.scene.add(this.root);
    this.root.add(this.tiltGroup);
    this.tiltGroup.add(this.body);

    const hair = hairNormalMap();
    const furOpts = {
      vertexColors: true, roughness: 0.64, metalness: 0, sheen: 0.6, sheenRoughness: 0.5, normalMap: hair,
      normalScale: new Vector2(0.6, 0.6), clearcoat: 0.08, clearcoatRoughness: 0.5,
    };
    this.fur = new MeshPhysicalMaterial(furOpts);
    this.earMat = new MeshPhysicalMaterial({ ...furOpts, vertexColors: false });
    this.pointsMat = new MeshPhysicalMaterial({ ...furOpts, vertexColors: false });

    const furColor = this.colorFn('body');
    this.torso = new Tube(30, 30, this.fur, furColor);
    this.neck = new Tube(10, 24, this.fur, this.colorFn('neck'));
    this.muzzle = new Tube(14, 22, this.fur, this.colorFn('muzzle'));
    this.jaw = new Tube(9, 16, this.fur, this.colorFn('muzzle'));
    this.tail = new Tube(16, 14, this.fur, this.colorFn('tail'));
    this.scruff = new Tube(6, 14, this.fur, furColor);
    const tongueMat = new MeshPhysicalMaterial({ color: '#E2667E', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    this.tongue = new Tube(8, 12, tongueMat, (_x, _y, _z, _u, _v, out) => { out[0] = out[1] = out[2] = 1; });
    tongueMat.vertexColors = false;
    for (let i = 0; i < 4; i++) this.legs.push(new Tube(18, 18, this.fur, this.colorFn('leg')));
    for (const t of [this.torso, this.neck, this.muzzle, this.jaw, this.tail, this.scruff, this.tongue, ...this.legs]) this.body.add(t.mesh);

    const sphere = new SphereGeometry(1, 36, 26);
    const blob = (mat = this.fur): Mesh => {
      const m = new Mesh(this.coloredSphere(), mat);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    this.skull = blob();
    this.cheeks = blob();
    for (let i = 0; i < 2; i++) this.thighs.push(blob());
    for (let i = 0; i < 2; i++) this.shoulders.push(blob());

    this.nose = new Mesh(sphere, new MeshPhysicalMaterial({ color: '#1B1310', roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
    this.nose.castShadow = true;
    this.mouthInside = new Mesh(sphere, new MeshStandardMaterial({ color: '#3A1214', roughness: 0.8 }));
    this.body.add(this.nose, this.mouthInside);

    // Ojos: globo café brillante con pupila y párpado del color del pelo.
    const irisMat = new MeshPhysicalMaterial({ color: '#5A2A10', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
    const pupilMat = new MeshPhysicalMaterial({ color: '#080605', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 });
    for (const side of [1, -1]) {
      const g = new Group();
      const ball = new Mesh(sphere, irisMat);
      ball.scale.setScalar(3.3);
      const pupil = new Mesh(sphere, pupilMat);
      pupil.scale.setScalar(1.75);
      pupil.position.set(1.35, 0.1, 2.3 * side);
      g.add(ball, pupil);
      g.userData.side = side;
      this.eyes.push(g);
      this.body.add(g);
      const brow = new Mesh(sphere, this.pointsMat);
      brow.scale.set(2.6, 1.6, 1.4);
      this.brows.push(brow);
      this.body.add(brow);
    }

    // Orejas largas: una hoja gruesa y algo curvada que cuelga de su raíz.
    const earGeo = this.coloredSphere(1, 28, 20);
    for (const side of [1, -1]) {
      const pivot = new Group();
      const ear = new Mesh(earGeo, this.earMat);
      ear.scale.set(10, 17, 2.4);
      ear.position.set(-1.5, -14, 0);
      ear.rotation.x = 0.16 * side;
      ear.castShadow = true;
      pivot.add(ear);
      pivot.userData.side = side;
      this.ears.push(pivot);
      this.body.add(pivot);
    }

    // Patas: almohadilla, tres dedos y uñas oscuras.
    const clawMat = new MeshStandardMaterial({ color: '#15100D', roughness: 0.4 });
    const clawGeo = new ConeGeometry(0.75, 2.6, 8);
    for (let i = 0; i < 4; i++) {
      const paw = new Group();
      const pad = new Mesh(this.coloredSphere(), this.fur);
      pad.scale.set(7, 3.6, 5.6);
      pad.castShadow = true;
      paw.add(pad);
      for (const dz of [-2.7, 0, 2.7]) {
        const toe = new Mesh(this.coloredSphere(), this.fur);
        toe.scale.set(2.5, 2.2, 2.1);
        toe.position.set(4.6, -0.9, dz);
        toe.castShadow = true;
        const claw = new Mesh(clawGeo, clawMat);
        claw.rotation.z = -Math.PI / 2 - 0.5;
        claw.position.set(6.9, -1.9, dz);
        paw.add(toe, claw);
      }
      paw.userData.pad = pad;
      this.paws.push(paw);
      this.body.add(paw);
    }

    // Collar con chapita.
    this.collar = new Mesh(new TorusGeometry(1, 0.14, 12, 48), new MeshPhysicalMaterial({ color: '#2F7FE0', roughness: 0.45, clearcoat: 0.4 }));
    this.tag = new Mesh(new CylinderGeometry(2.6, 2.6, 0.8, 24), new MeshPhysicalMaterial({ color: '#E8B53A', metalness: 0.9, roughness: 0.25 }));
    this.collar.castShadow = this.tag.castShadow = true;
    this.body.add(this.collar, this.tag);

    this.hats = { santa: this.santaHat(), witch: this.witchHat() };
    this.scarf = this.makeScarf();
    this.body.add(this.hats.santa, this.hats.witch, this.scarf);

    this.applyCoat();
  }

  // ------------------------------------------------------------- aspecto

  setLook(coat: string, outfit: Outfit3D): void {
    const next = COATS_3D[coat] ?? COATS_3D.red;
    if (next !== this.coat) {
      this.coat = next;
      this.applyCoat();
    }
    this.outfit = outfit;
  }

  private applyCoat(): void {
    const c = this.coat;
    this.fur.sheenColor = new Color(c.light).multiplyScalar(0.55);
    this.earMat.color = new Color(c.ear);
    this.earMat.sheenColor = new Color(c.light).multiplyScalar(0.4);
    this.pointsMat.color = new Color(c.points ?? c.fur);
    (this.nose.material as MeshPhysicalMaterial).color = new Color(c.nose);
    for (const g of this.eyes) ((g.children[0] as Mesh).material as MeshPhysicalMaterial).color = new Color(c.iris);
    for (const b of this.brows) b.visible = !!c.points;
    // Las esferas tienen el color "horneado" en sus vértices: se rehacen con el pelaje nuevo.
    for (const m of [this.skull, this.cheeks, ...this.thighs, ...this.shoulders, ...this.paws.flatMap((p) => p.children.filter((x) => (x as Mesh).material === this.fur) as Mesh[])]) {
      this.paintSphere(m.geometry, m === this.cheeks ? 'muzzle' : 'body');
    }
    for (const t of [this.torso, this.scruff]) t.setColorFn(this.colorFn('body'));
    this.neck.setColorFn(this.colorFn('neck'));
    this.muzzle.setColorFn(this.colorFn('muzzle'));
    this.jaw.setColorFn(this.colorFn('muzzle'));
    this.tail.setColorFn(this.colorFn('tail'));
    for (const l of this.legs) l.setColorFn(this.colorFn('leg'));
  }

  /** Color de cada vértice: lomo más oscuro, panza y pecho más claros, extremidades de color (negro y fuego) y manchas. */
  private colorFn(part: 'body' | 'neck' | 'muzzle' | 'leg' | 'tail'): ColorFn {
    const c = this.coat;
    const fur = new Color(c.fur), dark = new Color(c.dark), light = new Color(c.light);
    const points = c.points ? new Color(c.points) : null;
    const spots = c.spots ? new Color(c.spots) : null;
    const tmp = new Color();
    const seed = { body: 1, neck: 2, muzzle: 3, leg: 4, tail: 5 }[part];
    return (_nx, ny, _nz, u, v, out) => {
      tmp.copy(fur);
      if (ny > 0) tmp.lerp(dark, Math.min(1, ny) * (part === 'leg' ? 0.25 : 0.5));
      else tmp.lerp(light, Math.min(1, -ny) * (part === 'body' || part === 'neck' ? 0.45 : 0.2));
      if (points) {
        let k = 0;
        if (part === 'leg') k = smooth(0.42, 0.62, v);
        else if (part === 'muzzle') k = smooth(0.25, 0.55, v) * (ny < 0.3 ? 1 : 0.6);
        else if (part === 'neck' || part === 'body') k = ny < -0.55 && part === 'neck' ? 0.6 : 0;
        if (k > 0) tmp.lerp(points, k);
      }
      if (spots && part !== 'muzzle' && spotNoise(u, v, seed) > 0.7) tmp.lerp(spots, 0.85);
      out[0] = tmp.r;
      out[1] = tmp.g;
      out[2] = tmp.b;
    };
  }

  private coloredSphere(r = 1, w = 36, h = 26): SphereGeometry {
    const g = new SphereGeometry(r, w, h);
    this.paintSphere(g, 'body');
    return g;
  }

  private paintSphere(g: BufferGeometry, part: 'body' | 'muzzle'): void {
    const n = g.attributes.normal;
    const uv = g.attributes.uv;
    const colors = new Float32Array(n.count * 3);
    const fn = this.colorFn(part === 'muzzle' ? 'leg' : 'body');
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n.count; i++) {
      fn(n.getX(i), n.getY(i), n.getZ(i), uv.getX(i), part === 'muzzle' ? 1 : uv.getY(i), out);
      colors.set(out, i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
  }

  // ------------------------------------------------------------ disfraces

  private santaHat(): Group {
    const g = new Group();
    const red = new MeshPhysicalMaterial({ color: '#C8231E', roughness: 0.75, sheen: 1, sheenColor: new Color('#ff8a80') });
    const white = new MeshPhysicalMaterial({ color: '#F6F2EA', roughness: 0.9, sheen: 1 });
    const cone = new Mesh(new ConeGeometry(11, 22, 28, 1, true), red);
    cone.position.y = 11;
    const tip = new Mesh(new ConeGeometry(5.2, 14, 20), red);
    tip.position.set(-6, 22, 0);
    tip.rotation.z = 1.25;
    const brim = new Mesh(new TorusGeometry(11, 3.3, 14, 36), white);
    brim.rotation.x = Math.PI / 2;
    const pom = new Mesh(new SphereGeometry(4.2, 20, 14), white);
    pom.position.set(-13, 18.5, 0);
    for (const m of [cone, tip, brim, pom]) m.castShadow = true;
    g.add(cone, tip, brim, pom);
    return g;
  }

  private witchHat(): Group {
    const g = new Group();
    const purple = new MeshPhysicalMaterial({ color: '#3E2B63', roughness: 0.7, sheen: 0.6 });
    const brim = new Mesh(new CylinderGeometry(21, 21, 1.4, 40), purple);
    const cone = new Mesh(new ConeGeometry(10, 26, 28), purple);
    cone.position.y = 13;
    const tip = new Mesh(new ConeGeometry(3.6, 11, 16), purple);
    tip.position.set(-4.2, 27.5, 0);
    tip.rotation.z = 0.9;
    const band = new Mesh(new TorusGeometry(9.3, 1.4, 10, 36), new MeshPhysicalMaterial({ color: '#F08A24', roughness: 0.5 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 3;
    for (const m of [brim, cone, tip, band]) m.castShadow = true;
    g.add(brim, cone, tip, band);
    return g;
  }

  private makeScarf(): Group {
    const g = new Group();
    const mat = new MeshPhysicalMaterial({ map: stripeTexture('#C8302C', '#F4EEDF'), roughness: 0.85, sheen: 1, sheenColor: new Color('#ffb3a8') });
    const ring = new Mesh(new TorusGeometry(1, 0.32, 14, 40), mat);
    const end = new Mesh(new CylinderGeometry(3.6, 3.2, 18, 16), mat);
    ring.castShadow = end.castShadow = true;
    g.add(ring, end);
    g.userData = { ring, end };
    return g;
  }

  // -------------------------------------------------------------- tamaño

  /** Tamaño del lienzo: la caja (en unidades del perro) y dónde queda el punto de apoyo. */
  resize(box: { w: number; h: number; originX: number; originY: number }, scale: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(box.w * scale, box.h * scale, false);
    const elev = 0.2;
    const cam = this.camera;
    cam.left = -box.w / 2;
    cam.right = box.w / 2;
    cam.top = box.h / 2;
    cam.bottom = -box.h / 2;
    cam.updateProjectionMatrix();
    // Cámara un poco elevada; se corrige para que el punto de apoyo caiga exacto en el lienzo.
    const target = new Vector3(box.w / 2 - box.originX, (box.originY - box.h / 2) / Math.cos(elev), 0);
    cam.position.set(target.x, target.y + Math.sin(elev) * 1500, Math.cos(elev) * 1500);
    cam.lookAt(target);
  }

  // ------------------------------------------------------------- render

  private pts(name: string): Vector3[] {
    return (this.buf[name] ??= []);
  }

  render(v: View3D): void {
    const p = v.pose;
    const UP = new Vector3(0, 1, 0);
    const FWD = new Vector3(1, 0, 0);

    // Suelo y sombra de contacto.
    this.floor.position.y = -v.lift;
    const air = Math.min(1, v.lift / 120);
    this.contact.visible = air < 1;
    this.contact.scale.set(130 * (1 - 0.3 * air), 46 * (1 - 0.3 * air), 1);
    this.contact.position.x = v.offsetX + Math.cos(v.yaw) * -4;
    (this.contact.material as MeshBasicMaterial).opacity = 0.5 * (1 - air);

    // Giro, inclinación alrededor del punto agarrado y aplastamiento al caer.
    this.root.position.x = v.offsetX;
    this.root.rotation.y = v.yaw;
    this.root.scale.set(1 + (1 - v.squash) * 0.5, v.squash, 1 + (1 - v.squash) * 0.5);
    this.tiltGroup.position.set(v.pivotX, -v.pivotY, 0);
    this.tiltGroup.rotation.z = v.tilt;
    this.body.position.set(-v.pivotX, v.pivotY, 0);

    // --- Cuerpo: tubo de sección variable de la cadera al pecho (pecho hondo, cintura recogida).
    {
      const A = new Vector2(p.rumpX, p.rumpY), C = new Vector2(p.chestX, p.chestY);
      const d = new Vector2().subVectors(C, A).normalize();
      const down = new Vector2(-d.y, d.x);
      const start = A.clone().addScaledVector(d, -16), end = C.clone().addScaledVector(d, 15);
      const n = 30;
      const centers = this.pts('torso'), radii: [number, number][] = [];
      const breath = 1 + v.breath * 0.025;
      for (let i = 0; i < n; i++) {
        const t = 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1));
        // [t, alto, ancho, desplazamiento hacia abajo]
        const [hr, wr, dy] = profile([
          [0, 1.5, 1.5, 0], [0.04, 8.5, 8, 0], [0.11, 13.2, 12.4, 0.4], [0.22, 15.2, 13.6, 0.8], [0.38, 14.6, 12.6, 0],
          [0.52, 13.8, 12.2, -0.6], [0.66, 16.6, 13.4, 2.2], [0.8, 20.2, 14.4, 5.2], [0.9, 19, 13.6, 5], [0.96, 14.5, 10.5, 3.6], [1, 2, 2, 2.5],
        ], t);
        const ring = start.clone().lerp(end, t).addScaledVector(down, dy);
        (centers[i] ??= new Vector3()).copy(v3(ring.x, ring.y));
        const b = t > 0.6 ? breath : 1;
        radii.push([wr * b, hr * b]);
      }
      this.torso.update(centers, radii, UP);
    }

    // --- Muslos (más grandes al sentarse) y hombros.
    for (const [i, side] of [[0, 1], [1, -1]] as const) {
      const th = this.thighs[i];
      const k = p.haunch;
      th.visible = k > 0.05;
      th.position.copy(v3(p.rumpX + 4 + 2 * k, p.rumpY + 2 + k, 5.6 * side));
      th.scale.set((9 + 5 * k) * Math.max(0.3, k), (9 + 4 * k) * Math.max(0.3, k), 7.4 + 0.6 * k);
      th.rotation.z = 0.35 + 0.4 * k;
      const sh = this.shoulders[i];
      sh.visible = false;
      sh.position.copy(v3(p.chestX - 3, p.chestY + 2, 6.8 * side));
      sh.scale.set(8.5, 11, 6.2);
      sh.rotation.z = -0.35;
    }

    // --- Pellejo de la nuca (cuando lo levantan).
    this.scruff.mesh.visible = p.scruff > 0.02;
    if (this.scruff.mesh.visible) {
      const b = v3(p.chestX - 10, p.chestY - 9), tip = v3(p.chestX - 7, p.chestY - 9 - 13 * p.scruff);
      const c = this.pts('scruff');
      for (let i = 0; i < 6; i++) (c[i] ??= new Vector3()).copy(b).lerp(tip, i / 5);
      this.scruff.update(c, [[9, 9], [8, 8], [6.5, 6.5], [5, 5], [3.8, 3.8], [1.5, 1.5]], FWD);
    }

    // --- Cuello.
    const neckA = v3(p.chestX + 5, p.chestY - 6), neckB = v3(p.headX - 4, p.headY + 6);
    {
      const c = this.pts('neck');
      const mid = neckA.clone().lerp(neckB, 0.5).add(new Vector3(-1.5, 1.5, 0));
      sampleCurve([neckA.clone().add(new Vector3(-6, -4, 0)), neckA, mid, neckB, neckB.clone().add(new Vector3(4, 2, 0))], 10, c);
      const r: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const t = i / 9;
        r.push([lerp(12.5, 9.6, t), lerp(15.5, 11, t)]);
      }
      this.neck.update(c, r, FWD.clone().multiplyScalar(-1));
    }

    // --- Cabeza: cráneo, mejillas, hocico con mandíbula, nariz, ojos y orejas.
    const sa = p.snoutAng;
    const dir = new Vector3(Math.cos(sa), -Math.sin(sa), 0);
    const perpDown = new Vector3(-Math.sin(sa), -Math.cos(sa), 0);
    const headC = v3(p.headX, p.headY);
    this.skull.position.copy(headC);
    this.skull.scale.set(17, 15, 13.4);
    this.skull.rotation.z = -sa * 0.35;
    this.cheeks.position.copy(headC).addScaledVector(dir, 7).addScaledVector(perpDown, 4.5);
    this.cheeks.scale.set(10, 8.4, 11);
    this.cheeks.rotation.z = -sa * 0.6;

    const sb = v3(p.headX + 8, p.headY + 3);
    const tip = sb.clone().addScaledVector(dir, 29);
    {
      const c = this.pts('muzzle'), r: [number, number][] = [];
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        (c[i] ??= new Vector3()).copy(sb).lerp(tip, t).addScaledVector(perpDown, t * 1.2);
        const cap = t > 0.86 ? Math.sqrt(Math.max(0.02, 1 - ((t - 0.86) / 0.14) ** 2)) : 1;
        r.push([lerp(9.2, 5.2, t) * cap, lerp(10.4, 5.8, t) * cap]);
      }
      this.muzzle.update(c, r, UP);
    }
    this.nose.position.copy(tip).addScaledVector(dir, -0.6).addScaledVector(perpDown, -1.6);
    this.nose.scale.set(4.6, 3.7, 5.3);
    this.nose.rotation.z = -sa;

    const open = p.mouthOpen;
    const ja = sa + 0.06 + open * 0.62;
    const jdir = new Vector3(Math.cos(ja), -Math.sin(ja), 0);
    const hinge = sb.clone().addScaledVector(perpDown, 5.6).addScaledVector(dir, -1);
    {
      const c = this.pts('jaw'), r: [number, number][] = [];
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        (c[i] ??= new Vector3()).copy(hinge).addScaledVector(jdir, t * 23);
        const cap = t > 0.8 ? Math.sqrt(Math.max(0.02, 1 - ((t - 0.8) / 0.2) ** 2)) : 1;
        r.push([lerp(6, 3.4, t) * cap, lerp(3.6, 2.1, t) * cap]);
      }
      this.jaw.update(c, r, UP);
    }
    this.mouthInside.visible = open > 0.05;
    this.mouthInside.position.copy(hinge).addScaledVector(dir, 12).addScaledVector(perpDown, -1 + open * 2.5);
    this.mouthInside.scale.set(10, 1.5 + open * 3.6, 4.4);
    this.mouthInside.rotation.z = -(sa + ja) / 2;
    this.tongue.mesh.visible = p.tongue > 0.05 && open > 0.05;
    if (this.tongue.mesh.visible) {
      const c = this.pts('tongue');
      const t0 = hinge.clone().addScaledVector(jdir, 9).addScaledVector(perpDown, -1.4);
      const t1 = hinge.clone().addScaledVector(jdir, 25 + 5 * p.tongue).addScaledVector(perpDown, 2.5 * p.tongue);
      for (let i = 0; i < 8; i++) (c[i] ??= new Vector3()).copy(t0).lerp(t1, i / 7).addScaledVector(perpDown, Math.sin((i / 7) * Math.PI) * 1.5 * p.tongue);
      this.tongue.update(c, [[2.4, 1], [3.4, 1.2], [3.6, 1.3], [3.7, 1.3], [3.7, 1.3], [3.5, 1.3], [3, 1.2], [1.5, 0.8]], UP);
    }

    for (const g of this.eyes) {
      const side = g.userData.side as number;
      g.position.copy(headC).addScaledVector(dir, 9.6).add(new Vector3(0, 3.6, 8.6 * side));
      g.rotation.set(0, -0.62 * side, -sa * 0.4);
      const happy = p.eyeHappy > 0.5;
      const openY = happy ? 0.28 : Math.max(0.1, Math.min(1.25, p.eyeOpen));
      g.scale.set(1, openY, 1);
    }
    for (const [i, side] of [[0, 1], [1, -1]] as const) {
      this.brows[i].position.copy(headC).addScaledVector(dir, 8).add(new Vector3(0, 9.4, 8 * side));
    }

    for (const ear of this.ears) {
      const side = ear.userData.side as number;
      ear.position.copy(headC).add(new Vector3(-6.5, 10, 11.4 * side));
      ear.rotation.set(-0.06 * side, 0.12 * side, -p.earAng - sa * 0.2);
    }

    // --- Patas: hombro/cadera → codo/rodilla → muñeca/garrón → pata, con su articulación calculada.
    // En el dibujo 2D las patas lejanas van corridas hacia atrás para dar profundidad; aquí se corrige.
    const legDefs = [
      { j: [p.chestX - 2, p.chestY + 5], f: [p.ffx, p.ffy], z: 7, front: true },
      { j: [p.chestX - 2, p.chestY + 5], f: [p.ffx2 + 9, p.ffy2], z: -7, front: true },
      { j: [p.rumpX + 2, p.rumpY + 4], f: [p.rfx, p.rfy], z: 6.6, front: false },
      { j: [p.rumpX + 2, p.rumpY + 4], f: [p.rfx2 + 9, p.rfy2], z: -6.6, front: false },
    ];
    legDefs.forEach((L, i) => {
      const J = new Vector2(L.j[0], L.j[1]);
      const F = new Vector2(L.f[0], L.f[1]);
      const c = this.pts(`leg${i}`), r: [number, number][] = [];
      let ctrl: Vector2[];
      if (L.front) {
        const W = new Vector2(F.x - 0.5, F.y - 6.5);
        const E = knee(J, W, 11, 9.5, false);
        ctrl = [new Vector2(J.x + 1, J.y - 6), J, E, W, new Vector2(F.x + 0.5, F.y - 2.2)];
      } else {
        const H = new Vector2(F.x - 4.5, F.y - 9.5);
        const K = knee(J, H, 11, 8.8, true);
        ctrl = [new Vector2(J.x - 1, J.y - 6), J, K, H, new Vector2(F.x - 0.5, F.y - 2.2)];
      }
      sampleCurve(ctrl.map((q, k) => v3(q.x, q.y, k === 0 ? 0 : k === 1 ? L.z * 0.55 : L.z)), 18, c);
      for (let k = 0; k < 18; k++) {
        const t = k / 17;
        // [costado, adelante-atrás]: los muslos son anchos y planos; abajo la pata es redonda.
        const [lat, fwd] = L.front
          ? profile([[0, 5.6, 7.6], [0.32, 5.6, 7.4], [0.55, 4.9, 5.6], [0.75, 4.5, 4.8], [0.9, 4.6, 4.8], [1, 4.2, 4.3]], t)
          : profile([[0, 6, 10.5], [0.3, 6, 10], [0.5, 5, 6.2], [0.72, 4.2, 4.5], [0.9, 4.3, 4.4], [1, 3.9, 4]], t);
        r.push([lat, fwd]);
      }
      this.legs[i].update(c, r, FWD);
      const paw = this.paws[i];
      paw.position.copy(v3(F.x + 2, F.y + 1.2, L.z * 1.08));
      paw.rotation.set(0, L.z > 0 ? -0.18 : 0.18, 0);
    });

    // --- Cola: tres tramos como en el dibujo, y el meneo también hacia los costados.
    {
      const lens = [12, 11.5, 10];
      let x = p.rumpX - 13, y = p.rumpY - 5, z = 0;
      let a = p.tailAng + v.wag * 0.35;
      const ctrl = [v3(x + 5, y + 2, 0), v3(x, y, 0)];
      for (let i = 0; i < 3; i++) {
        x += Math.cos(a) * lens[i];
        y += Math.sin(a) * lens[i];
        z += Math.sin(v.wag * 2.2 + v.wagLag * i) * lens[i] * 0.55;
        ctrl.push(v3(x, y, z));
        a += p.tailCurl + v.wagLag * 0.25;
      }
      const c = this.pts('tail'), r: [number, number][] = [];
      sampleCurve(ctrl, 16, c);
      for (let k = 0; k < 16; k++) {
        const t = k / 15;
        const rad = lerp(5.4, 0.9, Math.pow(t, 0.9));
        r.push([rad, rad]);
      }
      this.tail.update(c, r, UP);
    }

    // --- Collar o bufanda.
    {
      const at = neckA.clone().lerp(neckB, 0.32);
      const tangent = new Vector3().subVectors(neckB, neckA).normalize();
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), tangent);
      const down = new Vector3(0, -1, 0).addScaledVector(tangent, tangent.y).normalize();
      const scarf = this.outfit === 'scarf';
      this.collar.visible = this.tag.visible = !scarf;
      // Base del collar: z = largo del cuello, x = costado, y = "arriba" del cuello.
      const side = new Vector3(0, 0, 1);
      const up = new Vector3().crossVectors(tangent, side).normalize().negate();
      q.setFromRotationMatrix(new Matrix4().makeBasis(side, up, tangent));
      this.collar.position.copy(at);
      this.collar.quaternion.copy(q);
      this.collar.scale.set(12.3, 15.2, 14);
      this.tag.position.copy(at).addScaledVector(up, -16.4).addScaledVector(tangent, 1.5);
      this.tag.quaternion.copy(q);
      this.tag.rotateX(Math.PI / 2);
      this.scarf.visible = scarf;
      if (scarf) {
        const { ring, end } = this.scarf.userData as { ring: Mesh; end: Mesh };
        ring.position.copy(at);
        ring.quaternion.copy(q);
        ring.scale.set(12.6, 15.6, 13);
        end.position.copy(at).addScaledVector(down, 18).add(new Vector3(-2, -6, 9));
        end.rotation.set(0.25, 0, 0.18);
      }
    }

    // --- Gorros.
    for (const kind of ['santa', 'witch'] as const) {
      const hat = this.hats[kind];
      hat.visible = this.outfit === kind;
      if (!hat.visible) continue;
      hat.position.copy(headC).add(new Vector3(-2, 11.5, 0));
      hat.rotation.set(0, 0, 0.28 - sa * 0.4);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
