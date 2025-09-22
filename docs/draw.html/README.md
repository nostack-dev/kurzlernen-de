# Touch Position Verification Tool (draw.html)

## Overview
`draw.html` is a lab instrument for tablets and touchscreens. It renders a full-screen SVG canvas and tracks every finger, showing live coordinates and trails so you can verify hardware accuracy or debug multi-touch gestures.

## Mechanics from first principles
1. **Pointer capture** – The page listens to `touchstart`, `touchmove`, `touchend`, and `touchcancel` events on the `<svg>` element. Default gestures (`touch-action`) and text selection are disabled so raw coordinates come through untouched.
2. **Vector display** – Each active touch spawns a `<circle>` inside the `#touchPoints` group. Radius and opacity reflect movement, and the `data-touch-id` attribute ties DOM nodes to the browser’s `identifier` property.
3. **Logging** – Every touch event is logged into `#debugWindow`. The toggle button simply adds or removes the `.show` class so testers can review the scrollable event stream without cluttering the UI.

## UI landmarks
- **Instructions overlay** reminds you which gestures to try.
- **Debug button** in the top-right corner opens the event console.
- **SVG grid**: background shading makes it easy to eyeball drift as you move.

## Experiments to try
- Perform a five-finger pinch and watch the circles shrink toward a common center.
- Hold one finger still while drawing with another to confirm separate touch IDs update independently.
- Toggle the debug window and copy the JSON-like logs into a bug report.

## Developer nuggets
- Because everything lives in SVG, exporting a screenshot with `toDataURL` would be straightforward if needed.
- The code intentionally uses `passive: false` on event listeners so it can call `preventDefault()` and avoid scrolling.
- Touch points fade out by removing them during `touchend`; add easing or trails by storing previous positions in an array.

This page turns invisible finger data into bright circles so you can reason about touch input from the hardware layer up.
