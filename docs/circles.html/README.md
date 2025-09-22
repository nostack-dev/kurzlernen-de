# Circles & Lines Playground (circles.html)

## Quick summary
This page is a geometry sandbox: drag to draw circles, right-click-drag to lay down lines, and tweak a grid to explore compass-and-straightedge constructions with modern mouse gestures.

## First principles breakdown
1. **Coordinate capture** – Mouse events track screen coordinates (`clientX/Y`) and convert them into CSS positions. Every circle stores its center and radius so it can be redrawn precisely after undo/redo operations.
2. **State history** – A plain JavaScript array acts as an undo stack. Each drawn element is recorded with its class name and inline styles. `redrawFromHistory()` rebuilds the DOM by replaying that stack.
3. **Vector math** – When you drag the live line or circle, the code uses `Math.atan2` and `Math.hypot` to convert raw distances into angles and lengths. That keeps rendered lines and radius handles consistent even after panning or scaling.

## How to play
- **Left click + drag**: define the center of a new measuring circle. Hold `Alt` to instantly stamp a circle using the last radius.
- **Right click + drag**: draw straight lines between two points. Middle click enables viewport panning to explore large constructions.
- **Ctrl + drag on a circle**: resize it interactively. Each circle gets a red handle you can tug for fine adjustments.
- **Grid controls**: buttons in the corner nudge the spacing in five-pixel increments so you can align shapes precisely.
- **Undo/redo**: revisit your steps like in a drawing app—the script replays every stored element.

## Fun experiments
- Recreate a Euclidean triangle construction and then overlay the circumcircle using the circle handle.
- Increase the grid size dramatically to simulate zooming out, then use the panning gesture to navigate.
- Mix circles and red vectors to visualize complex-number addition: each vector is just a one-pixel-wide div rotated into place.

## Developer notes
- The layout relies on absolutely positioned `<div>` elements (`.circle`, `.line`, `.vector`) layered inside a full-screen container.
- The `fixedPoint` marker and ghost preview circle are reusable UI aids that appear while dragging.
- No canvas is used—everything is DOM-based, making CSS-based styling or exporting to SVG straightforward.

This file turns geometry class into a tactile playground where lines and arcs obey the math you learned from first principles.
