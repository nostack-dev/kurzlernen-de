# Sinus & Cosinus Oscillator Game (oscigame.html)

## Experience
`oscigame.html` visualizes Lissajous figures in 3D. Using Three.js, it traces the motion of two perpendicular oscillators and lets you manipulate frequency, amplitude, and phase with mouse gestures or keyboard shortcuts.

## Mechanics
1. **Parametric motion** – A trail of vertices is updated each frame based on `sin(2πf₁t + φ₁)` and `cos(2πf₂t + φ₂)` with adjustable amplitudes. The path is drawn with a translucent `THREE.Line` whose alpha fades along the tail.
2. **Interaction scheme** – Right-click drag changes parameters: horizontal drags adjust cosine values, vertical drags sine values. Modifiers `Alt` and `Ctrl` toggle between amplitude and phase adjustments; no modifier means frequency.
3. **Camera control** – WASD + QE keys move the camera freely (“shooter” controls). Press `F` to reset to the default orbit and restore oscillator defaults.
4. **Center of mass** – The script computes the mean position of recent points to keep the visualization centered and to aim the camera when resetting.

## Playful challenges
- Create knots by setting `frequencySin : frequencyCos` to small integer ratios like 3:4.
- Hold `Alt` and drag to exaggerate amplitudes, turning the pattern into a stretched ribbon.
- Spin phases with `Ctrl` drags to morph from sine/cosine alignment into swirling helices.

## Developer insights
- Geometry buffers (`trailGeometry`) are reused; positions and per-vertex alpha values are updated in place for performance.
- Animation uses `requestAnimationFrame` and `Date.now()` to compute elapsed time since reset.
- Lighting (ambient + point light attached to the camera) keeps the trail glowing regardless of camera orientation.

This game lets learners feel how sine and cosine combine—by literally grabbing frequencies and phases and watching the math draw neon sculptures in the air.
