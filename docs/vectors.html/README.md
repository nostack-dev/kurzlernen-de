# Advanced Vector Drawing Application (vectors.html)

## Purpose
`vectors.html` is a CAD-lite editor built on HTML Canvas. It lets you draw points, connect them into segments, detect faces, and even export the resulting geometry as an ASCII STL file for 3D printing or further modeling.

## Capabilities
1. **Sketching** – Left-click to place points, drag to create segments, and snap to existing vertices or guideline intersections. A selection rectangle (`#selectionRect`) supports multi-select for moving groups.
2. **Precision tools** – The alignment overlay shows angles and lengths in real time. Holding modifier keys enables axis locking or midpoint snapping, making orthogonal or symmetrical designs easy.
3. **Face detection** – When closed loops are formed, the app identifies polygonal faces, fills them, and lists them for extrusion/export.
4. **Project persistence** – Buttons save/load JSON snapshots of all points and segments, so you can resume editing later.
5. **STL export** – `exportSTL()` triangulates detected faces and bundles them into an ASCII STL string that downloads instantly—perfect for quickly prototyping laser-cut or printed parts.
6. **Help system** – A built-in modal enumerates every shortcut and gesture so users can onboard themselves.

## Try these activities
- Sketch a simple house (rectangle + triangle roof) and export to STL to see how 2D faces become 3D shells.
- Use the alignment status readout to create vectors at exact 45° increments.
- Practice selecting multiple points with the marquee, then press Delete to remove them as a group.

## Developer notes
- Geometry is stored in arrays of point and edge objects; computations like face detection iterate over these structures. The deterministic order keeps exports consistent.
- Canvas rendering is layered: grid background, segments, points, selection overlay, and UI elements are drawn sequentially each frame.
- Export uses a simple fan triangulation; for concave polygons consider switching to ear clipping.

This application bridges art and engineering: draw freely, but with enough precision to manufacture what you sketch.
