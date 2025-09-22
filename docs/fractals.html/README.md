# Enhanced IFS Fractal Generator (fractals.html)

## Big idea
This page builds fractals using Iterated Function Systems (IFS). You control up to four affine transformations, assign probabilities, choose colors, and then let a Web Worker crunch millions of points that paint onto a canvas you can zoom and pan.

## Under the hood
1. **Affine transforms** – Each transformation is represented by sliders `a` through `f`, encoding the matrix `[a b; c d]` and translation `(e, f)`. These define how points are scaled, skewed, rotated, and moved.
2. **Probability selection** – Because each iteration randomly picks a transformation, the `probabilities` panel ensures the sum equals 1. The UI auto-normalizes your inputs.
3. **Web Worker acceleration** – The heavy lifting happens off the main thread. A blob-based worker receives the transformation set, generates point batches, and posts them back. The main thread draws them with `ImageData` for speed.
4. **Color gradients** – Each transformation has an associated color. During plotting, the worker blends colors across iterations, letting fern leaves fade from bright tips to shadowed stems.

## Interface landmarks
- **Transform cards**: enable/disable transformations, adjust matrices, and preview their effect.
- **Probabilities section**: quick buttons to equalize weights or randomize them for exploration.
- **Color palette**: pick base hues, shuffle them, or load presets like Barnsley Fern or Sierpinski triangle.
- **Export options**: download PNGs, save parameter JSON, or copy shareable presets.
- **Advanced insights**: live statistics show bounding boxes, iteration counts, and runtime.

## Playful experiments
- Start with the Barnsley preset, then slightly tweak translation values to morph the fern into alien plants.
- Turn off one transformation to see how the attractor collapses and why each map is essential.
- Enable “auto zoom” to let the viewport follow the fractal’s bounding box as it evolves.

## Implementation hints
- The canvas uses `requestAnimationFrame` while dragging for smooth pan/zoom interactions, then snaps back to normal rendering.
- Worker messages contain typed arrays for performance; keep them small if you add more metadata.
- Animation controls are scaffolded but intentionally left unimplemented—great stretch goal if you want to interpolate between presets.

Fractals emerge from simple linear algebra plus randomness. This tool invites you to tweak those primitives until stunning self-similar art appears.
