# Classic IFS Fractal Generator (noise.html)

## Overview
`noise.html` is the original iterated function system explorer. It renders fractals point-by-point on a canvas while letting you tweak up to three affine transformations and their probabilities.

## Mechanics
1. **Affine maps** – Sliders labelled A–F define transformation matrices just like in the enhanced version. Each transform can be toggled individually, allowing quick experiments with fewer functions.
2. **Random iteration** – `generateIFSFractal()` seeds a starting point and repeatedly applies a randomly selected transformation according to the probability sliders. The resulting coordinates are scaled into canvas space and plotted as single pixels.
3. **Zoom controls** – Buttons adjust a zoom factor and translation offsets, letting you dive into fractal detail without recomputing parameters.
4. **Color themes** – Each transformation has a fixed color assignment. Blending is minimal, giving crisp triangular or fern-like patterns.

## Interface highlights
- **Transform panels**: a concise UI without the advanced sections from `fractals.html`, ideal for teaching fundamentals.
- **Probability sliders**: normalized automatically to sum to 1; a text indicator confirms the total.
- **Reset + randomize**: one-click ways to explore new shapes quickly.

## Suggested activities
- Disable all but one transformation to see how linear maps alone stretch the starting point.
- Gradually reintroduce additional transforms to watch the attractor emerge.
- Play with extreme shear values to create glitch-art effects.

## Developer tips
- The rendering loop is synchronous; for millions of points consider adding a Web Worker (see the enhanced version for inspiration).
- Canvas resizing is manual—adjust width/height attributes for higher resolution exports.
- Because colors are basic, this is a good base for teaching palette generation or depth shading.

Use this page to grasp IFS fundamentals before diving into the feature-rich `fractals.html` upgrade.
