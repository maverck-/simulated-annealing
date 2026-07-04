/**
 * Generación del terreno (la función objetivo a maximizar).
 * Misma idea que la demo ep01 de Computer-Science-Series (E. Schirtz):
 * suma de cosenos con fases aleatorias, normalizada a [0, 1].
 * Aquí la función es continua en x ∈ [0, 1] en vez de una grilla.
 */

const MUESTRAS = 2048;

// Margen lateral donde el terreno se atenúa para que ninguna cima
// quede pegada al borde de la pantalla (la esfera se perdería).
const MARGEN = 0.12;
const PISO_BORDE = 0.45; // fracción de altura que conservan los bordes

function envolvente(t) {
  const d = Math.min(t, 1 - t);
  if (d >= MARGEN) return 1;
  const u = d / MARGEN;
  const s = u * u * (3 - 2 * u); // smoothstep
  return PISO_BORDE + (1 - PISO_BORDE) * s;
}

export function crearTerreno(opciones = {}, rng = Math.random) {
  const comps = [
    { f: opciones.f1 ?? 2,   a: 1.0  },
    { f: opciones.f2 ?? 7,   a: 0.25 },
    { f: opciones.f3 ?? 20,  a: 0.1  },
    { f: opciones.f4 ?? 0.5, a: 1.65 },
  ].map((c) => ({ ...c, phi: rng() * 2 * Math.PI }));

  const cruda = (t) => {
    let s = 2;
    for (const c of comps) s += c.a * Math.cos(2 * Math.PI * c.f * t + c.phi);
    return Math.abs(s) * envolvente(t); // sin valles negativos ni cimas al borde
  };

  // Normalización y búsqueda del óptimo global por muestreo fino
  let max = 0;
  let xMax = 0;
  for (let i = 0; i <= MUESTRAS; i += 1) {
    const t = i / MUESTRAS;
    const v = cruda(t);
    if (v > max) { max = v; xMax = t; }
  }

  // Refinamiento local alrededor del pico: sin esto, entre dos muestras
  // f puede superar levemente 1 y x* mostraría "1.0000" sin estar en la cima
  const lo = Math.max(0, xMax - 1 / MUESTRAS);
  const hi = Math.min(1, xMax + 1 / MUESTRAS);
  for (let i = 0; i <= 400; i += 1) {
    const t = lo + (i / 400) * (hi - lo);
    const v = cruda(t);
    if (v > max) { max = v; xMax = t; }
  }

  const f = (t) => cruda(Math.min(1, Math.max(0, t))) / max;

  return { f, optimo: { x: xMax, altura: 1 } };
}
