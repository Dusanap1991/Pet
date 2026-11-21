/**
 * Calculadora de la nota rápida: "= 12*8", "15% de 2300", "(3+4)/2", "2^10".
 * Sin eval: un analizador chico que solo entiende números y operaciones.
 */

/** ¿El texto parece una cuenta? (empieza con "=", con "cuánto es", o son solo números y signos). */
export function looksLikeMath(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (t.startsWith('=')) return true;
  if (/^(cu[aá]nto es|calcula)\b/.test(t)) return true;
  if (/^\d+(?:[.,]\d+)?\s*%\s*de\s*\d/.test(t)) return true;
  return /^[\d\s.,+\-*/x×÷()%^]+$/.test(t) && /\d\s*[+\-*/x×÷^]\s*[\d(]/.test(t);
}

/** Calcula; devuelve null si no es una cuenta válida. */
export function calc(raw: string): number | null {
  let t = raw.trim().toLowerCase().replace(/^=/, '').replace(/^(cu[aá]nto es|calcula)\s*/, '').replace(/\?$/, '').trim();
  // "15% de 2300" → 15/100*2300
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*%\s*de\s*/g, '($1/100)*');
  t = t.replace(/×|x/g, '*').replace(/÷/g, '/').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, '');
  if (!t || /[^0-9.+\-*/()%^]/.test(t)) return null;
  let i = 0;
  const peek = (): string => t[i] ?? '';
  const num = (): number => {
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(t.slice(i));
    if (!m) throw new Error('número');
    i += m[0].length;
    let v = Number(m[0]);
    if (peek() === '%') {
      i++;
      v /= 100;
    }
    return v;
  };
  const atom = (): number => {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error(')');
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -atom();
    }
    if (peek() === '+') {
      i++;
      return atom();
    }
    return num();
  };
  const power = (): number => {
    const base = atom();
    if (peek() === '^') {
      i++;
      return base ** power();
    }
    return base;
  };
  const term = (): number => {
    let v = power();
    while (peek() === '*' || peek() === '/') {
      const op = t[i++];
      const r = power();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = t[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr();
    return i === t.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** 1234567.891 → "1.234.567,89" (formato chileno). */
export function formatNumber(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('es-CL', { maximumFractionDigits: 2 });
}
