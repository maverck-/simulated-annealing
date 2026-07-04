# Demo — Recocido Simulado (Simulated Annealing)

Demo visual interactiva para la Actividad 1 de **MII902 Optimización Estocástica**.

Una esfera de metal fundido busca la cima más alta de un terreno montañoso.
Mientras la temperatura es alta acepta saltos a estados peores (exploración);
al enfriarse, solo acepta mejoras (explotación). **Toda la escena es
termocrómica**: los colores pasan de forja incandescente a azul acero a medida
que baja la temperatura real del algoritmo.

Basada en la idea de la demo *ep01* de
[Computer-Science-Series](https://github.com/eschirtz/Computer-Science-Series)
(Eric Schirtzinger), reescrita desde cero sin dependencias.

## Cómo ejecutar

Usa módulos ES, así que necesita un servidor (no funciona abriendo el archivo
directo). Desde esta carpeta:

```bash
python3 -m http.server 8000
```

y abrir <http://localhost:8000>.

## Correspondencia con el pseudocódigo del curso (Pasos 0–6)

- **Paso 0**: `Reiniciar` — x⁰ aleatorio, T = T₀, t ← 0, x* ← x⁰.
- **Pasos 2–3**: `js/annealing.js` — movimiento provisorio Δx en ±paso y
  criterio de aceptación `p = e^(Δ/T)`, comparado contra `r`. Un rechazo **vuelve al Paso 2**:
  no avanza t (el HUD separa *iteración t* de *propuestas*).
- **Paso 4**: x* es el punto blanco ("mejor").
- **Paso 5**: T baja cada **L** movimientos aceptados (enfriamiento por mesetas).
- **Pasos 1 y 6**: termina por **t_máx**, por ~500 rechazos seguidos
  ("ningún Δx aceptable" ⇒ óptimo local) o por congelamiento (T < 0.0005,
  resguardo práctico).

## Controles

| Parámetro | Significado |
|---|---|
| **T₀** | Temperatura inicial (q): más alta ⇒ más exploración al comienzo |
| **α** | Tasa de enfriamiento geométrico, T ← α·T al cerrar cada meseta |
| **L** | Meseta: movimientos aceptados por nivel de temperatura (Paso 5) |
| **t_máx** | Límite de iteraciones aceptadas (condición de término, Paso 1) |

Fijo en el código (`js/main.js`, objeto `params`): **tamaño de paso = 5 %**
del dominio como radio del vecindario M.

Barra inferior izquierda: **Play/Pausa**, **Reiniciar** (mismo terreno),
**velocidad 1× / 5× / 10× / 100×** (1× = 5 propuestas/s; toda corrida nueva
parte en 1× para seguir el paso a paso con calma), **Nuevo terreno** y
**Recalentar** (nueva corrida con x⁰ = posición actual y t ← 0, conservando
x* — útil para mostrar escape de un óptimo local). La velocidad es solo ritmo
visual: no cambia la matemática.

Teclado: `espacio` iniciar/pausar · `R` reiniciar · `N` nuevo terreno ·
`V` velocidad.

## Qué mirar durante la presentación

- **Tag xᵗ sobre la pelota**: la solución actual (dice x⁰ antes de partir).
- **Anillos verdes**: candidato *aceptado* — la pelota se mueve ahí, sea mejor
  o peor (si era peor, fue por el criterio de Metropolis).
- **Círculos rojos**: candidato *rechazado* — la pelota no se movió.
- **Punto x⁰**: dónde partió la corrida (Recalentar lo reubica).
- **HUD izquierdo**: fórmula de Boltzmann `p = e^(Δz/q)` y número aleatorio
  `r` de la última propuesta peor; el gráfico va arriba a la derecha.
- **Tags en escena**: `Óptimo Global` sobre la cima más alta y `x*` sobre el
  mejor estado encontrado. Al terminar, comparar ambos.

## Estructura

```
index.html          página
css/estilo.css      estilos de la interfaz
js/annealing.js     el algoritmo (criterio de Metropolis + enfriamiento)
js/terreno.js       función objetivo: suma de cosenos con fases aleatorias
js/main.js          simulación, render del canvas y controles
```

`js/annealing.js` es el archivo para mostrar en clase: ~40 líneas, sin nada de
dibujo.
