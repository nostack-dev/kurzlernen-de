# Deterministic 2D Physics Editor (physics.html)

## Purpose
`physics.html` is a sandbox where you can design rigid-body scenes and run deterministic simulations. It combines an editor (add bodies, joints, forces) with a custom physics integrator—no external engine required.

## Building blocks
1. **Body definitions** – Objects are circles or polygons stored in the `bodies` array with properties like mass, restitution, and color. The sidebar form populates these fields and pushes new bodies when you click “+ Add Object”.
2. **Forces & constraints** – Gravity, drag, and user-defined impulses are applied each frame. Joints link body pairs with configurable stiffness/damping, stored in the `joints` array.
3. **Deterministic stepper** – A fixed timestep integrator updates positions and velocities using semi-implicit Euler. Because the timestep is constant, replaying the same sequence yields identical results.
4. **Collision handling** – Broad-phase AABB checks precede narrow-phase collision resolution. Restitution and friction coefficients from the body data influence the response.
5. **Undo/redo** – Editor actions push snapshots onto stacks so you can rewind design changes. Buttons in the corner are disabled when no history exists.

## UI highlights
- **Right sidebar**: collapsible `<details>` sections for world settings, objects, joints, and advanced tweaks (drag coefficients, contact solver iterations).
- **Canvas**: double-click to select bodies, drag to reposition, and use hotkeys for quick duplication or deletion.
- **Overlay widgets**: FPS counter, pause/play, and toggles to show collision normals or bounding boxes.

## Experiments
- Build a Newton’s cradle by adding aligned circles, connecting them with joints, and tuning restitution.
- Increase solver iterations to see how stacking stability improves.
- Switch gravity to zero and enable drag to simulate space robotics manipulations.

## Developer notes
- All state is plain JavaScript objects—perfect for exporting JSON or creating sharing links.
- Rendering uses Canvas 2D; physics and drawing are decoupled so you can swap in WebGL if desired.
- Determinism hinges on using `performance.now()` only for diagnostics; physics updates rely on accumulated fixed timesteps.

With this file, you can teach mechanics from first principles: define forces, see outcomes, iterate.
