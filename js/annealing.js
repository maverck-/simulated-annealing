/**
 * Núcleo del algoritmo de Recocido Simulado (Simulated Annealing).
 * Independiente del dibujo: ejecuta UNA propuesta de movimiento,
 * es decir, los Pasos 2 y 3 del pseudocódigo del curso.
 * Aquí maximizamos f(x) (la altura), así que Δz = Δ = f(vecino) − f(actual).
 *
 * Paso 3 — Criterio de aceptación (Metropolis):
 *   - Si Δ ≥ 0 (mejora)  → se acepta siempre.
 *   - Si Δ < 0 (empeora) → se acepta con probabilidad p = e^(Δ/T)
 *     (distribución de Boltzmann; T es el parámetro de control q).
 */

export function pasoRecocido(actual, f, T, paso, rng = Math.random) {
  // Paso 2 — Movimiento provisorio: Δx uniforme dentro del vecindario ±paso
  let x = actual.x + (rng() * 2 - 1) * paso;
  x = Math.min(1, Math.max(0, x));

  const altura = f(x);
  const delta = altura - actual.altura;

  let aceptado;
  let p = 1;

  if (delta >= 0) {
    aceptado = true;
  } else {
    p = Math.exp(delta / Math.max(T, 1e-12));
    aceptado = rng() < p;
  }

  return { x, altura, delta, p, aceptado, empeora: delta < 0 };
}

/** Paso 5 — Reducción de temperatura geométrica: T ← α · T
    (main.js la aplica cada L movimientos aceptados: enfriamiento por mesetas) */
export function enfriar(T, alfa) {
  return T * alfa;
}
