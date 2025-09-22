# Minimal Deterministic Physics Sandbox (physicssimple.html)

## Intent
`physicssimple.html` distills the full physics editor into an approachable demo. You spawn circles, fling them with deterministic velocities, toggle gravity, and watch them collide—all without fiddling with complex forms.

## Key mechanics
1. **Circle spawning** – Right-click drops a circle with a seeded pseudo-random velocity so repeated experiments are reproducible. Hold `Alt` while dragging to choose the velocity vector manually.
2. **Dragging** – Left-click drag on an existing circle sets its new velocity based on drag distance, making momentum conservation intuitive.
3. **Deterministic updates** – Like the full editor, the integrator runs on a fixed timestep. Resetting the simulation yields identical motion sequences if you repeat the same inputs.
4. **Collision resolution** – Circles collide elastically with boundary walls and each other using simple impulse math tuned for clarity over realism.

## UI cues
- Instructions overlay enumerates every shortcut.
- Control panel toggles gravity, friction, restitution, and the deterministic seed.
- FPS counter ensures the browser keeps up with the calculations.

## Experiments
- Set gravity off, spawn a triangle of circles with equal velocities, and observe the conservation of momentum.
- Toggle gravity on mid-simulation to see how trajectories curve realistically.
- Adjust restitution to compare bouncy vs damped collisions.

## Developer notes
- Code is cleanly separated into physics update, rendering, and input handlers—ideal for teaching how games structure loops.
- Deterministic randomness uses a seeded PRNG; tweak the seed slider to generate different but repeatable launch patterns.
- For extension, add polygon bodies by mimicking the circle data structure.

This file is perfect for first encounters with physics simulation: hands-on, repeatable, and friendly.
