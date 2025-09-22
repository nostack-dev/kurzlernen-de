# Rotating Sinus Lab (extrema_rotation.html)

## What sets this variant apart?
`extrema_rotation.html` is a classroom-ready clone of the sinus explorer with emphasis on the rotation slider. It highlights how rotating a base vector changes both period and amplitude simultaneously, making phase shifts tangible.

## System model
1. **Input vector** – Sliders start with `(2, 1)` as the unrotated vector. That corresponds to a period of `2 * 4 = 8` units and amplitude `1`.
2. **Rotation transform** – The `rotateVector` helper applies the standard 2D rotation matrix, producing the coordinates actually used to compute the wave. These rotated values are fed back into the slider readouts so students immediately see the numerical effect.
3. **Wave generation** – `generateSinusFromVector` samples 500 points from `-2π` to `2π`, multiplies them by the rotated period, and maps the results to canvas pixels.

## Teaching checklist
- Draw attention to the red vector anchored at the canvas center. Its length and orientation mirror the rotated vector driving the sine curve.
- Use the rotation slider to show phase shifts: at 180° the sine flips vertically, at 270° the amplitude appears negative.
- Pause at 45° and ask learners to compute the expected components before revealing the displayed `(x, y)` label.

## Customization ideas
- Increase `points` in `generateSinusFromVector` for smoother lines if you ever expand the canvas width.
- Change the baseline by editing the slider `min`/`max` values to explore extreme amplitudes or micro periods.
- Add derivative curves or shaded extrema by extending `drawSinusCurve()`—the structure leaves plenty of room.

## Implementation notes
- All event listeners use `input` events so the wave updates continuously as the slider moves.
- The canvas axes are redrawn each frame; extracting them into a helper would make it easier to add grid lines or labels.
- Because period is derived as `xKomponente * 4`, the default vector ensures one full sine cycle fits nicely into the viewport.

Use this page when you want students to *feel* the algebra behind sinusoidal rotations, not just memorize formulas.
