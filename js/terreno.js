/**
 * Generación del terreno (la función objetivo a maximizar).
 * Misma idea que la demo ep01 de Computer-Science-Series (E. Schirtz):
 * suma de cosenos con fases aleatorias, normalizada a [0, 1].
 * Aquí la función es continua en x ∈ [0, 1] en vez de una grilla.
 *
 * El paisaje se condiciona para no chocar con la interfaz:
 *  - Bordes de pantalla: atenuación para que ninguna cima quede cortada.
 *  - Esquinas superiores (HUD y gráfico): altura limitada, así ninguna
 *    cima ni sus tags quedan tapados por las tarjetas.
 *  - Piso de valles: la esfera nunca se hunde tras los controles inferiores.
 *  - El óptimo global se exige dentro de la banda central despejada;
 *    si no, se regenera el terreno (muestreo por rechazo).
 */

const MUESTRAS = 2048;

// Margen lateral donde el terreno se atenúa para que ninguna cima
// quede pegada al borde de la pantalla (la esfera se perdería).
const MARGEN = 0.12;
const PISO_BORDE = 0.45; // fracción de altura que conservan los bordes

// Zonas superiores ocupadas por las tarjetas flotantes (HUD / gráfico)
const ZONA_TARJETA = 0.24;   // fracción del ancho bajo cada tarjeta
const TRANSICION = 0.1;      // suavizado hacia la banda central
const FACTOR_TARJETA = 0.66; // altura relativa máxima bajo las tarjetas
const ALTURA_SEGURA = 0.72;  // tope normalizado tolerado bajo las tarjetas
const BANDA_OPTIMO = [0.28, 0.72]; // el óptimo global debe caer aquí
const PISO_VALLE = 0.12;     // los valles no bajan de esta altura
const MAX_INTENTOS = 40;

function envolvente(t) {
  const d = Math.min(t, 1 - t);
  if (d >= MARGEN) return 1;
  const u = d / MARGEN;
  const s = u * u * (3 - 2 * u); // smoothstep
  return PISO_BORDE + (1 - PISO_BORDE) * s;
}

/** Atenuación bajo las tarjetas superiores: FACTOR_TARJETA dentro de la
    zona, subiendo suave a 1 hacia la banda central. */
function despeje(t) {
  const d = Math.min(t, 1 - t);
  if (d >= ZONA_TARJETA + TRANSICION) return 1;
  if (d <= ZONA_TARJETA) return FACTOR_TARJETA;
  const u = (d - ZONA_TARJETA) / TRANSICION;
  const s = u * u * (3 - 2 * u);
  return FACTOR_TARJETA + (1 - FACTOR_TARJETA) * s;
}

function generar(opciones, rng, proteger) {
  const comps = [
    { f: opciones.f1 ?? 2,   a: 1.0  },
    { f: opciones.f2 ?? 7,   a: 0.25 },
    { f: opciones.f3 ?? 20,  a: 0.1  },
    { f: opciones.f4 ?? 0.5, a: 1.65 },
  ].map((c) => ({ ...c, phi: rng() * 2 * Math.PI }));

  const cruda = (t) => {
    let s = 2;
    for (const c of comps) s += c.a * Math.cos(2 * Math.PI * c.f * t + c.phi);
    let v = Math.abs(s) * envolvente(t); // sin valles negativos ni cimas al borde
    if (proteger) v *= despeje(t);
    return v;
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

  // Piso de valles: comprime hacia [PISO_VALLE, 1] manteniendo el máximo en 1
  const piso = proteger ? PISO_VALLE : 0;
  const f = (t) => piso + (1 - piso) * (cruda(Math.min(1, Math.max(0, t))) / max);

  return { f, optimo: { x: xMax, altura: 1 } };
}

/** ¿Óptimo en la banda central y sin cimas altas bajo las tarjetas? */
function esValido(terreno) {
  if (terreno.optimo.x < BANDA_OPTIMO[0] || terreno.optimo.x > BANDA_OPTIMO[1]) {
    return false;
  }
  for (let i = 0; i <= 256; i += 1) {
    const t = i / 256;
    const d = Math.min(t, 1 - t);
    if (d <= ZONA_TARJETA && terreno.f(t) > ALTURA_SEGURA) return false;
  }
  return true;
}

export function crearTerreno(opciones = {}, rng = Math.random) {
  const proteger = opciones.protegerInterfaz ?? true;
  let terreno = generar(opciones, rng, proteger);
  if (!proteger) return terreno;
  for (let intento = 0; intento < MAX_INTENTOS && !esValido(terreno); intento += 1) {
    terreno = generar(opciones, rng, proteger);
  }
  return terreno;
}
