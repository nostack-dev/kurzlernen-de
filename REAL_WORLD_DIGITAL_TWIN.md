# Real-world digital twin

The browser simulator has two world modes: **TRAINING RANGE** and **REAL WORLD · MY LOCATION**.

REAL WORLD is deliberately static/serverless. A user gesture requests high-accuracy browser geolocation, the WGS84 latitude/longitude becomes the horizontal origin of the existing local east/north/up metre frame, and the browser loads the map directly from **OpenFreeMap** using **OpenStreetMap / OpenMapTiles** data. There is no account, API key, billing setup, application backend, proxy, or repository secret.

The real-world renderer uses MapLibre GL JS with the OpenFreeMap Liberty style. The OpenMapTiles `building` layer is extruded from `render_height` and `render_min_height` when those OSM-derived values exist. This gives a simple 3D city/world context without changing the aircraft model.

The aircraft is rendered through the simulator's **existing THREE flight renderer and existing flight camera**. REAL WORLD does not create a second THREE WebGL renderer and does not hook the renderer prototype. Each simulator render frame explicitly gives the current renderer, scene and camera to the geospatial adapter; when WORLD is active, that same transparent flight canvas is composited over MapLibre. FOLLOW, THIRD and FPV therefore remain the simulator's normal camera modes rather than separate map-camera modes.

Flight truth remains unchanged: the exact shared firmware runtime still consumes the same raw ICM/SBUS/NAV1 hardware boundary; motor pulses still drive the same Box3D plant; mass, inertia, motor/prop dynamics, drag, battery model, sensor cadence and controller semantics are untouched by world selection.

Map geometry is **visual/geospatial context, not collision truth**. No building or map polygon is silently turned into a physics collider. The existing local collision/rangefinder world remains authoritative until a separately verified collision/elevation source is introduced. Likewise, OpenFreeMap vector data is not treated as a terrain-elevation measurement; local `z=0` remains the simulator launch plane.

Training mode performs no external map request. REAL WORLD fetches OpenFreeMap tiles only after the user explicitly chooses WORLD / USE MY GPS LOCATION.

## WORLD flight envelope and mobile visual budget

WORLD keeps the same controller and raw NAV1 boundary, but the GAME/solo AGL target envelope is **0.5–50.0 m**. NAV1 transports AGL as unsigned millimetres, so 50 m remains below its 65.535 m wire ceiling. The browser navigation twin uses a 60 m downward ground ray; with the controller's 25° maximum GAME tilt, a 50 m vertical AGL corresponds to about 55.2 m slant range and therefore remains inside that simulated sensor envelope. Raising the target beyond 50 m requires a verified longer-range/fused altitude source or a protocol change rather than silently fabricating sensor authority.

The aircraft/controller/Box3D loop is not throttled for map performance. THREE still renders the flight scene on every display frame. Only the MapLibre geospatial camera adapter is capped at 30 updates/s with sub-pixel/sub-angle change suppression, a 1.0 map pixel ratio, a 1.25 WORLD flight pixel-ratio cap, no MapLibre MSAA, a smaller tile cache depth and no explicit redundant repaint. WORLD also disables the flight shadow pass while the training ground is hidden, restoring it on return to TRAINING RANGE.

For human visual acquisition, WORLD uses a dark-blue sky/horizon instead of a black void, brighter 3D-building contrast, a more readable aircraft material palette and a thin WORLD-only cyan orientation halo around the aircraft in FOLLOW/THIRD. The halo is hidden in FPV. These are render cues only; they do not affect collision, sensors, controller state or dynamics.
