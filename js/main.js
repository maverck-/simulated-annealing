/**
 * Orquestación: simulación, render termocrómico y controles.
 * Sigue el pseudocódigo del curso (Pasos 0–6):
 *   - t cuenta solo movimientos ACEPTADOS; un rechazo vuelve al Paso 2.
 *   - La temperatura baja cada L movimientos aceptados (mesetas, Paso 5).
 *   - Termina por t_máx, por falta de movimientos aceptables (Paso 1)
 *     o por congelamiento (T bajo el umbral, backstop práctico).
 * El algoritmo (Pasos 2–3) vive en annealing.js; el terreno en terreno.js.
 */
import { pasoRecocido, enfriar } from './annealing.js';
import { crearTerreno } from './terreno.js';

// ————— Constantes —————

const T_MIN = 5e-4;          // backstop: bajo esto se considera congelado
const RECHAZOS_MAX = 500;    // rechazos seguidos ≈ "ningún Δx aceptable" (Paso 1)
const MAX_PROP_FRAME = 3000; // tope de propuestas por cuadro

// Paletas caliente / fría; la escena interpola entre ambas según T
const CALIDO = {
  cieloA: [58, 20, 8], cieloB: [217, 106, 27],
  ridge: [178, 78, 16], tierra: [31, 15, 7],
  nucleo: [255, 246, 200], halo: [255, 174, 66],
};
const FRIO = {
  cieloA: [10, 17, 32], cieloB: [72, 98, 127],
  ridge: [42, 62, 88], tierra: [10, 14, 22],
  nucleo: [228, 235, 245], halo: [159, 184, 216],
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ————— Estado —————

// paso (vecindario) queda fijo; T₀, α, L y t_máx se exponen en el panel.
const params = { t0: 1, alfa: 0.95, nivelL: 10, tMax: 1000, paso: 0.05 };

// Velocidad: siempre parte lenta (1×) para seguir el paso a paso;
// el botón de la barra multiplica la base.
const VEL_BASE = 3; // propuestas/s a 1×
const MULTIPLICADORES = [1, 5, 10, 100];
const DURACION_FANTASMA = 1.15;
const DURACION_RECHAZO = 0.95;
const DURACION_PULSO = 0.9;
let velIndice = 0;

let terreno, fondo;            // función objetivo y silueta decorativa
let actual, mejor;             // x^t y x* del pseudocódigo
let inicio;                    // x⁰: donde partió la corrida actual
let T;                         // parámetro de control q
let iter;                      // t: movimientos aceptados
let propuestas;                // pasadas por el Paso 2 (incluye rechazos)
let desdeEnfriado;             // aceptados desde la última reducción de T
let rechazosSeguidos;
let modo = 'listo';            // listo | ejecucion | pausado | detenido
let ultimaPeor = null;         // última propuesta que empeoraba (para la fórmula)

let renderX = 0.5;             // posición suavizada de la esfera
let pulsos = [];               // anillos verdes al aceptar un candidato
let rechazos = [];             // círculos rojos de propuestas rechazadas
let rastro = [];               // huellas de estados aceptados
let fantasmas = [];            // silueta de la base anterior al moverse xᵗ

let hist = { altura: [], mejor: [], temp: [] };
let stride = 1;                // decimación del historial

let acumulador = 0;
let tPrevio = performance.now();

// ————— DOM —————

const $ = (id) => document.getElementById(id);
const escena = $('escena');
const ctx = escena.getContext('2d');
const grafico = $('grafico');
const gtx = grafico.getContext('2d');

const dom = {
  formula: $('formula-texto'),
  play: $('btn-play'), iconoPlay: $('icono-play'), iconoPausa: $('icono-pausa'),
  vel: $('btn-vel'),
};

// ————— Utilidades —————

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

/** Trunca (no redondea) para mostrar: 0.9998 → "0.999" y no "1.000",
    así se nota cuando x* aún no es exactamente el óptimo. */
function recortar(v, dec = 3) {
  const f = 10 ** dec;
  return (Math.trunc(v * f + Math.sign(v) * 1e-7) / f).toFixed(dec);
}

function color(par, h, alfa = 1) {
  const c = CALIDO[par], f = FRIO[par];
  const r = Math.round(mix(f[0], c[0], h));
  const g = Math.round(mix(f[1], c[1], h));
  const b = Math.round(mix(f[2], c[2], h));
  return `rgba(${r},${g},${b},${alfa})`;
}

/** Calor visual: 1 = forja, 0 = congelado. Curva suave para que el
    enfriamiento se note durante toda la corrida y no solo al inicio. */
function calor() {
  if (modo === 'listo') return 1;
  return Math.pow(clamp01(T / params.t0), 0.4);
}

// ————— Simulación —————

function reiniciar({ nuevoTerreno = false } = {}) {
  if (nuevoTerreno || !terreno) {
    terreno = crearTerreno();
    fondo = crearTerreno({ f3: 2 });
  }
  // Paso 0: x⁰ aleatorio, T = T₀, t ← 0, x* ← x⁰
  T = params.t0;
  iter = 0;
  propuestas = 0;
  desdeEnfriado = 0;
  rechazosSeguidos = 0;
  const x = Math.random();
  actual = { x, altura: terreno.f(x) };
  mejor = { ...actual, iter: 0 };
  inicio = { ...actual };
  renderX = x;
  pulsos = []; rechazos = []; rastro = []; fantasmas = [];
  hist = { altura: [], mejor: [], temp: [] };
  stride = 1;
  acumulador = 0;
  ultimaPeor = null;
  fijarVelocidad(0); // toda corrida nueva parte lenta, a 1×
  cambiarModo('listo');
}

function fijarVelocidad(indice) {
  velIndice = indice;
  dom.vel.textContent = `${MULTIPLICADORES[velIndice]}×`;
}

function cicloVelocidad() {
  fijarVelocidad((velIndice + 1) % MULTIPLICADORES.length);
}

/** Una pasada por los Pasos 2–6. Devuelve al bucle cuando hay rechazo
    (volver al Paso 2 = la siguiente llamada). */
function iterar() {
  const propuesta = pasoRecocido(actual, terreno.f, T, params.paso); // Pasos 2–3
  propuestas += 1;

  if (propuesta.empeora) ultimaPeor = { ...propuesta, T };

  if (propuesta.aceptado) {
    iter += 1; // Paso 6: t avanza solo con movimiento aceptado
    rechazosSeguidos = 0;
    if (!reduceMotion && fantasmas.length < 20) {
      fantasmas.push({ x: actual.x, altura: actual.altura, edad: 0 }); // base que deja atrás
    }
    actual = { x: propuesta.x, altura: propuesta.altura };
    if (!reduceMotion) {
      if (pulsos.length < 60) pulsos.push({ x: propuesta.x, edad: 0, delta: propuesta.delta });
      if (rastro.length < 160) rastro.push({ x: propuesta.x, edad: 0 });
    }
    // Paso 4: actualización de la mejor solución x*
    if (actual.altura > mejor.altura) mejor = { ...actual, iter };

    // Paso 5: reducción de T tras L movimientos aceptados (meseta)
    desdeEnfriado += 1;
    if (desdeEnfriado >= params.nivelL) {
      T = enfriar(T, params.alfa);
      desdeEnfriado = 0;
    }

    // Paso 1: condiciones de término
    if (iter >= params.tMax) detener('t máx alcanzado');
    else if (T < T_MIN) detener('congelado');
  } else {
    rechazosSeguidos += 1;
    if (!reduceMotion && rechazos.length < 40) {
      rechazos.push({ x: propuesta.x, altura: propuesta.altura, edad: 0, delta: propuesta.delta });
    }
    // Paso 1: sin movimientos aceptables en el vecindario → óptimo local
    if (rechazosSeguidos >= RECHAZOS_MAX) detener('óptimo local');
  }

  if (propuestas % stride === 0) {
    hist.altura.push(actual.altura);
    hist.mejor.push(mejor.altura);
    hist.temp.push(clamp01(T / params.t0));
    if (hist.altura.length > 1200) {
      for (const k of Object.keys(hist)) hist[k] = hist[k].filter((_, i) => i % 2 === 0);
      stride *= 2;
    }
  }
}

function detener() {
  cambiarModo('detenido');
}

function cambiarModo(nuevo) {
  modo = nuevo;
  // classList y no .hidden: los SVG no son HTMLElement y lo ignoran
  const corriendo = nuevo === 'ejecucion';
  dom.iconoPlay.classList.toggle('oculto', corriendo);
  dom.iconoPausa.classList.toggle('oculto', !corriendo);
}

// ————— Render de la escena —————

function tamano() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = escena.clientWidth, h = escena.clientHeight;
  if (escena.width !== w * dpr || escena.height !== h * dpr) {
    escena.width = w * dpr;
    escena.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: w, H: h };
}

/** Píldora con etiqueta y valor, como los tags de las láminas del curso.
    El valor va levemente más grande y con más peso que la etiqueta. */
const FUENTE_ETIQUETA = '16px "Geist Mono", ui-monospace, Menlo, monospace';
const FUENTE_VALOR = '600 19px "Geist Mono", ui-monospace, Menlo, monospace';

const FUENTE_ETIQUETA_CHICA = '13.5px "Geist Mono", ui-monospace, Menlo, monospace';
const FUENTE_VALOR_CHICO = '600 16.5px "Geist Mono", ui-monospace, Menlo, monospace';

function dibujarTag(etiqueta, valor, cx, cy, chico = false) {
  const fEtiqueta = chico ? FUENTE_ETIQUETA_CHICA : FUENTE_ETIQUETA;
  const fValor = chico ? FUENTE_VALOR_CHICO : FUENTE_VALOR;
  ctx.font = fEtiqueta;
  const anchoEtiqueta = ctx.measureText(etiqueta).width;
  ctx.font = fValor;
  const anchoValor = valor ? ctx.measureText(valor).width : 0;
  const ancho = anchoEtiqueta + anchoValor + (chico ? 22 : 28);
  const alto = chico ? 29 : 34;
  const pad = chico ? 11 : 14;
  const x = cx - ancho / 2;
  const y = cy - alto;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, ancho, alto, chico ? 7 : 8);
  else ctx.rect(x, y, ancho, alto);
  ctx.fillStyle = 'rgba(15,11,8,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(242,233,221,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = fEtiqueta;
  ctx.fillStyle = 'rgba(242,233,221,0.88)';
  ctx.fillText(etiqueta, x + pad, y + alto / 2 + 0.5);
  if (valor) {
    ctx.font = fValor;
    ctx.fillStyle = 'rgba(242,233,221,1)';
    ctx.fillText(valor, x + pad + anchoEtiqueta, y + alto / 2 + 0.5);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
}

/** Δz flotante junto al candidato; solo a 1× y 5×, cuando se narra paso a paso */
function dibujarDelta(delta, cx, cy, alfa, aceptado) {
  if (velIndice > 1 || delta === undefined) return;
  ctx.font = FUENTE_VALOR_CHICO;
  ctx.textAlign = 'center';
  const c = aceptado ? '159,214,138' : '224,122,106';
  ctx.fillStyle = `rgba(${c},${Math.min(0.98, alfa * 2.1)})`;
  const signo = delta >= 0 ? '+' : '';
  ctx.fillText(`Δz = ${signo}${delta.toFixed(3)}`, cx, cy);
}

function dibujarSilueta(f, W, H, base, escala, fill) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  const paso = Math.max(2, W / 480);
  for (let px = 0; px <= W + paso; px += paso) {
    const t = clamp01(px / W);
    ctx.lineTo(px, base - f(t) * escala);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function dibujar(dt) {
  const { W, H } = tamano();
  const h = calor();

  const yDe = (a) => H * 0.94 - a * H * 0.66; // altura [0,1] → pantalla
  const radio = Math.min(16, Math.max(9, W * 0.011));

  // Cielo
  const cielo = ctx.createLinearGradient(0, 0, 0, H);
  cielo.addColorStop(0, color('cieloA', h));
  cielo.addColorStop(1, color('cieloB', h));
  ctx.fillStyle = cielo;
  ctx.fillRect(0, 0, W, H);

  // Cordillera de fondo (decorativa) y terreno real
  dibujarSilueta(fondo.f, W, H, H * 0.86, H * 0.44, color('ridge', h));

  // Resplandor de la esfera contra el cielo
  const bx = renderX * W;
  const by = yDe(terreno.f(renderX)) - radio;
  if (h > 0.03) {
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, radio * 7);
    glow.addColorStop(0, color('halo', h, 0.55 * h));
    glow.addColorStop(1, color('halo', h, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(bx - radio * 7, by - radio * 7, radio * 14, radio * 14);
  }

  dibujarSilueta(terreno.f, W, H, H * 0.94, H * 0.66, color('tierra', h));

  // Óptimo global: triángulo tenue + tag sobre la cima más alta
  const ox = terreno.optimo.x * W;
  const oy = yDe(1);
  ctx.fillStyle = 'rgba(242,233,221,0.4)';
  ctx.beginPath();
  ctx.moveTo(ox, oy - 14);
  ctx.lineTo(ox - 5, oy - 24);
  ctx.lineTo(ox + 5, oy - 24);
  ctx.closePath();
  ctx.fill();
  // Línea que conecta el tag con la flecha
  ctx.strokeStyle = 'rgba(242,233,221,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, oy - 84);
  ctx.lineTo(ox, oy - 26);
  ctx.stroke();
  // Elevado para no solapar el tag x* cuando la mejor solución llega a la cima
  dibujarTag('Óptimo Global: ', terreno.optimo.altura.toFixed(2), ox, oy - 84);

  // Mejor estado encontrado (x*)
  if (mejor && iter > 0) {
    const mx = mejor.x * W, my = yDe(mejor.altura);
    ctx.strokeStyle = 'rgba(242,233,221,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx, my - 6);
    ctx.lineTo(mx, my - 38);
    ctx.stroke();
    dibujarTag('x*: ', recortar(mejor.altura, 4), mx, my - 40);
  }

  // Huellas de estados aceptados
  for (const p of rastro) {
    p.edad += dt;
    const a = Math.max(0, 0.35 - p.edad * 0.12);
    if (a <= 0) continue;
    ctx.fillStyle = color('halo', h, a);
    ctx.beginPath();
    ctx.arc(p.x * W, yDe(terreno.f(p.x)), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  rastro = rastro.filter((p) => p.edad < 3);

  // Fantasma de la base anterior: silueta sutil donde estaba xᵗ
  for (const p of fantasmas) {
    p.edad += dt;
    const a = Math.max(0, 0.36 * (1 - p.edad / DURACION_FANTASMA));
    if (a <= 0) continue;
    ctx.fillStyle = color('nucleo', h, a);
    ctx.beginPath();
    ctx.arc(p.x * W, yDe(p.altura) - radio, radio, 0, Math.PI * 2);
    ctx.fill();
  }
  fantasmas = fantasmas.filter((p) => p.edad < DURACION_FANTASMA);

  // Candidato rechazado: círculo rojo que se desvanece
  for (const p of rechazos) {
    p.edad += dt;
    const a = Math.max(0, 0.68 * (1 - p.edad / DURACION_RECHAZO));
    if (a <= 0) continue;
    ctx.strokeStyle = `rgba(224,122,106,${a})`;
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.arc(p.x * W, yDe(p.altura) - radio, radio, 0, Math.PI * 2);
    ctx.stroke();
    dibujarDelta(p.delta, p.x * W, yDe(p.altura) + 22, a, false);
  }
  rechazos = rechazos.filter((p) => p.edad < DURACION_RECHAZO);

  // Candidato aceptado: anillo verde que se expande
  for (const p of pulsos) {
    p.edad += dt;
    const a = Math.max(0, 0.72 * (1 - p.edad / DURACION_PULSO));
    if (a <= 0) continue;
    ctx.strokeStyle = `rgba(159,214,138,${a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x * W, yDe(terreno.f(p.x)) - radio, radio * (1 + p.edad * 3.4), 0, Math.PI * 2);
    ctx.stroke();
    dibujarDelta(p.delta, p.x * W, yDe(terreno.f(p.x)) + 22, a, true);
  }
  pulsos = pulsos.filter((p) => p.edad < DURACION_PULSO);

  // x⁰: punto de partida de la corrida, siempre bajo la superficie
  if (inicio) {
    const sx = inicio.x * W, sy = yDe(inicio.altura);
    ctx.fillStyle = 'rgba(242,233,221,0.55)';
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,233,221,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy + 5);
    ctx.lineTo(sx, sy + 13);
    ctx.stroke();
    dibujarTag('x⁰: ', recortar(inicio.altura), sx, sy + 42, true);
  }

  // La esfera: metal fundido que se solidifica
  const esfera = ctx.createRadialGradient(
    bx - radio * 0.3, by - radio * 0.35, radio * 0.15,
    bx, by, radio,
  );
  esfera.addColorStop(0, color('nucleo', h));
  esfera.addColorStop(1, color('halo', h));
  ctx.fillStyle = esfera;
  ctx.beginPath();
  ctx.arc(bx, by, radio, 0, Math.PI * 2);
  ctx.fill();

  // Tag de la solución actual sobre la pelota. Aparece recién con el primer
  // movimiento (antes basta el x⁰) y se omite si chocaría con el tag de x*.
  const tagBolaY = by - radio - 8;
  const chocaConMejor = Math.abs(bx - mejor.x * W) < 130
    && Math.abs(tagBolaY - (yDe(mejor.altura) - 40)) < 46;
  if (iter > 0 && !chocaConMejor) {
    dibujarTag('xᵗ: ', recortar(terreno.f(renderX)), bx, tagBolaY, true);
  }
}

// ————— Gráfico del historial —————

function dibujarGrafico() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = grafico.clientWidth, hh = grafico.clientHeight;
  if (grafico.width !== w * dpr || grafico.height !== hh * dpr) {
    grafico.width = w * dpr;
    grafico.height = hh * dpr;
  }
  gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gtx.clearRect(0, 0, w, hh);

  const n = hist.altura.length;
  if (n < 2) return;

  const px = (i) => (i / (n - 1)) * w;
  const py = (v) => hh - 4 - v * (hh - 8);

  const linea = (serie, estilo, ancho) => {
    gtx.strokeStyle = estilo;
    gtx.lineWidth = ancho;
    gtx.beginPath();
    for (let i = 0; i < n; i += 1) {
      i === 0 ? gtx.moveTo(px(0), py(serie[0])) : gtx.lineTo(px(i), py(serie[i]));
    }
    gtx.stroke();
  };

  linea(hist.temp, 'rgba(143,180,227,0.8)', 1);
  linea(hist.mejor, 'rgba(242,233,221,0.55)', 1);
  linea(hist.altura, 'rgba(255,156,63,0.95)', 1.5);
}

// ————— HUD —————

function actualizarHUD() {
  if (ultimaPeor) {
    const u = ultimaPeor;
    const comparador = u.aceptado ? '&lt;' : '&gt;';
    const veredicto = u.aceptado
      ? '<span class="veredicto veredicto-si">Acepta</span>'
      : '<span class="veredicto veredicto-no">Rechaza</span>';
    dom.formula.innerHTML =
      `<span class="formula-expresion">
        <span class="formula-termino">p = ${u.p.toFixed(3)}</span>
        <span class="formula-termino">r = ${u.r.toFixed(3)}</span>
        <span class="formula-termino formula-comparacion">r ${comparador} p</span>
      </span>
      ${veredicto}`;
  }
}

// ————— Bucle principal —————

function cuadro(ahora) {
  const dt = Math.min((ahora - tPrevio) / 1000, 0.1);
  tPrevio = ahora;

  if (modo === 'ejecucion') {
    acumulador += dt * VEL_BASE * MULTIPLICADORES[velIndice];
    let n = Math.min(Math.floor(acumulador), MAX_PROP_FRAME);
    acumulador -= n;
    while (n > 0 && modo === 'ejecucion') {
      iterar();
      n -= 1;
    }
  }

  // Suavizado del movimiento de la esfera
  const k = 1 - Math.exp(-dt * 12);
  renderX += (actual.x - renderX) * k;

  dibujar(dt);
  dibujarGrafico();
  actualizarHUD();
  requestAnimationFrame(cuadro);
}

// ————— Controles —————

function conectarControles() {
  const enlazar = (id, salida, formato, aplicar) => {
    const input = $(id), out = $(salida);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = formato(v);
      aplicar(v);
    });
  };

  enlazar('in-t0', 'out-t0', (v) => v.toFixed(2), (v) => {
    params.t0 = v;
    if (modo === 'listo') T = v; // antes de iniciar, T sigue a T₀
  });
  enlazar('in-alfa', 'out-alfa', (v) => v.toFixed(2), (v) => { params.alfa = v; });
  enlazar('in-nivel', 'out-nivel', (v) => String(v), (v) => { params.nivelL = v; });
  enlazar('in-tmax', 'out-tmax', (v) => String(v), (v) => { params.tMax = v; });

  dom.play.addEventListener('click', alternar);
  dom.vel.addEventListener('click', cicloVelocidad);

  $('btn-reiniciar').addEventListener('click', () => reiniciar());
  $('btn-terreno').addEventListener('click', () => reiniciar({ nuevoTerreno: true }));
  // Recalentar = nueva corrida con x⁰ = posición actual, conservando x*
  $('btn-recalentar').addEventListener('click', () => {
    T = params.t0;
    iter = 0;
    desdeEnfriado = 0;
    rechazosSeguidos = 0;
    inicio = { ...actual };
    if (modo === 'detenido') cambiarModo('ejecucion');
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
    if (e.code === 'Space') { e.preventDefault(); alternar(); }
    if (e.key === 'r' || e.key === 'R') reiniciar();
    if (e.key === 'n' || e.key === 'N') reiniciar({ nuevoTerreno: true });
    if (e.key === 'v' || e.key === 'V') cicloVelocidad();
  });
}

function alternar() {
  if (modo === 'ejecucion') cambiarModo('pausado');
  else if (modo === 'detenido') { reiniciar(); cambiarModo('ejecucion'); }
  else cambiarModo('ejecucion');
}

// ————— Arranque —————

reiniciar({ nuevoTerreno: true });
conectarControles();
requestAnimationFrame((t) => { tPrevio = t; requestAnimationFrame(cuadro); });
