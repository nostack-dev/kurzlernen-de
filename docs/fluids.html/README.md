# Optimized 3D Fluid Simulation (fluids.html)

## Snapshot
This page renders a pseudo-3D particle fluid simulation entirely on the GPU using WebGL. Thousands of particles flow inside a cubic box while sliders let you tune viscosity, damping, and pressure stiffness in real time.

## Physics from first principles
1. **Particles** – Each fluid parcel is a `Particle` instance with position, velocity, and color state. The initializer distributes them evenly across a grid, giving every cell a starting direction.
2. **Advection** – `streamParticles()` advances positions by velocity each frame (`p.position += p.velocity * dt`). Boundary checks bounce particles off the cube walls by inverting velocities.
3. **Collisions & pressure** – Density is accumulated via `mapParticlesToGrid()`. `applyPressureForces()` compares each particle’s density to neighboring cells, nudging it away from overcrowded regions. The `pressureSlider` scales those forces.
4. **Viscosity** – `applyViscosity()` dampens velocity magnitude in smooth regions and re-randomizes direction when counts exceed the `viscosityThreshold`. That mimics how honey-like fluids resist shear.

## Rendering pipeline
- WebGL shaders draw each particle as a glowing point (`gl_PointSize = 8.0`).
- The projection + model-view matrices orbit the camera slowly so the cloud appears three-dimensional.
- Colors encode velocity magnitude—fast-moving particles glow warm, slower ones cool.

## Controls at a glance
- **Viscosity Threshold**: how many particles must share a cell before the sim smears them together.
- **Damping Factor**: scales velocity retention each frame (`velocity *= damping`).
- **Pressure Stiffness**: increases repulsion in dense zones, preventing clumping.
- **Reset Simulation**: reinitializes particles with the latest parameter settings.

## Experiments
- Drop the damping to 0.5 and watch the fluid become energetic and chaotic.
- Raise viscosity to freeze sections into thick blobs—perfect to explain laminar vs turbulent flow.
- Pause the orbiting camera by setting `rotationSpeed` to zero (search for the `rotationSpeed` constant) to examine internal structure.

## Implementation hints
- The simulation runs inside an animation loop capped with `requestAnimationFrame` and `performance.now()` time steps.
- Physics and rendering share the same `particles` array, so you can easily expand `Particle` with temperature or pressure visuals.
- WebGL buffer updates stream positions every frame; consider using instanced rendering if you raise the particle count dramatically.

This file is a mini fluid dynamics lab: tweak the knobs, observe emergent behavior, and connect slider math to real-world viscosity and pressure concepts.
