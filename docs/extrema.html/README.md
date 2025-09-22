# Sinus Vector Explorer (extrema.html)

## What it is
`extrema.html` visualizes how a sine wave emerges from a rotating vector. Sliders adjust the vector’s horizontal (period) and vertical (amplitude) components, and the canvas draws both the resulting wave and the vector that generates it.

## First principles refresher
1. **Vector rotation** – `rotateVector(x, y, angle)` converts slider values into a rotated basis using the classic rotation matrix `[cos θ, -sin θ; sin θ, cos θ]`.
2. **Sampling the wave** – `generateSinusFromVector` computes evenly spaced x-values from `-2π` to `2π` and evaluates the sine function with the rotated amplitude and period. This mirrors the formula `y = A sin(2πx / T)`.
3. **Rendering** – The canvas is cleared each frame, axes are redrawn, and the blue sinusoid is plotted by mapping mathematical coordinates to screen space. The red vector extends to the first peak (period/4) so students can compare vector length and wave amplitude directly.

## Guided tour
- **X-Komponente slider** manipulates the effective period: shorter values compress the wave, longer values stretch it.
- **Y-Komponente slider** controls amplitude: higher values create taller peaks and deeper valleys.
- **Rotation slider** spins the underlying vector while updating the on-screen value readout.

## Learning games
- Set the rotation to 90° and notice how the x- and y-components swap roles, flipping the wave’s phase.
- Try matching a desired period (e.g., two cycles across the canvas) by adjusting the x-component.
- Challenge students to predict the coordinate label displayed next to the red vector before it updates.

## Implementation tidbits
- Canvas scaling is handled manually: x-values scale by `width / (4π)` and y-values by `height / 4` to keep everything centered.
- Slider events are bound with `input` listeners so updates feel immediate.
- Because everything is computed fresh each draw, you can add overlays (derivative curves, tangent lines) by extending `drawSinusCurve()`.

This file turns trigonometry into an interactive toy where vectors, waves, and rotations dance together.
