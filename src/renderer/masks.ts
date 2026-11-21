/**
 * Siluetas de cada video (las genera scripts/clips/process.py). Se compilan en
 * un archivo aparte que dogvideo.ts carga cuando hace falta.
 */
import quieto from '../../assets/dog/quieto.mask.json';
import caminar from '../../assets/dog/caminar.mask.json';
import correr from '../../assets/dog/correr.mask.json';
import sentarse from '../../assets/dog/sentarse.mask.json';
import sentado from '../../assets/dog/sentado.mask.json';
import levantarse from '../../assets/dog/levantarse.mask.json';
import echado from '../../assets/dog/echado.mask.json';
import dormir from '../../assets/dog/dormir.mask.json';
import olfatear from '../../assets/dog/olfatear.mask.json';
import comer from '../../assets/dog/comer.mask.json';
import feliz from '../../assets/dog/feliz.mask.json';
import ladrar from '../../assets/dog/ladrar.mask.json';
import type manifest from '../../assets/dog/manifest.json';

/** Silueta real del perro en cada cuadro (celdas de `cell` px) y dónde están su cabeza y su nariz. */
export interface Mask {
  cell: number;
  cols: number;
  rows: number;
  frames: string[];
  head: number[][];
  nose: number[][];
  /** Patas apoyadas en cada cuadro: [centro x, ancho]. */
  feet?: number[][][];
  /** Ancho del cuerpo cerca del suelo: [x0, x1]. */
  span?: number[][];
}

export type MaskTable = Record<keyof typeof manifest.clips, Mask>;

export const MASKS: MaskTable = { quieto, caminar, correr, sentarse, sentado, levantarse, echado, dormir, olfatear, comer, feliz, ladrar };
