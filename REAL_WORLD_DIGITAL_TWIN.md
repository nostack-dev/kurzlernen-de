# Real-world digital twin

The simulator supports two world modes: the local training range and a georeferenced real-world view at the user's current browser location.

## Architecture boundary

Real-world rendering is an adapter around the existing flight simulator. It does not replace or modify the flight plant, motor model, sensor model, firmware runtime, controller, mass, inertia, thrust, drag, or Box3D dynamics.

The browser requests an explicit high-accuracy geolocation fix, anchors a local east-north-up (ENU) metric frame to that WGS84 location, and renders Google Photorealistic 3D Tiles through CesiumJS. The existing Three.js camera pose is transformed from the local SI frame into Earth-fixed coordinates for rendering.

The sampled 3D surface at the GPS origin is used only to georeference the local launch plane. Streamed photogrammetry is not silently treated as collision truth. Building and terrain collision physics remain limited to geometry that is explicitly represented in the simulator's physics world.

## Hardware-fit principle

The control path remains:

`raw sensor wire -> fc::FirmwareRuntime -> fc::StateRuntime -> fc::Runtime -> ESC pulses -> physical plant`

The real-world visual layer is outside that path. This keeps SIL, physical S31 HIL, and production firmware on the same control/runtime boundary.

## Location and API key

Geolocation is requested through the browser permission model. The Google Maps Tiles API key is entered by the user and stored only in that browser's local storage; it is not committed to the repository. Google/Cesium attribution remains visible in real-world mode.
