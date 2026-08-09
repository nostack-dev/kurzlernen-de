# Real-world digital twin

The browser simulator has two world modes: **TRAINING RANGE** and **REAL WORLD · MY LOCATION**.

REAL WORLD is deliberately static/serverless. A user gesture requests high-accuracy browser geolocation, the WGS84 latitude/longitude becomes the horizontal origin of the existing local east/north/up metre frame, and the browser loads the map directly from **OpenFreeMap** using **OpenStreetMap / OpenMapTiles** data. There is no account, API key, billing setup, application backend, proxy, or repository secret.

The real-world renderer uses MapLibre GL JS with the OpenFreeMap Liberty style. The OpenMapTiles `building` layer is extruded from `render_height` and `render_min_height` when those OSM-derived values exist. This gives a simple 3D city/world context without changing the aircraft model.

Flight truth remains unchanged: the exact shared firmware runtime still consumes the same raw ICM/SBUS/NAV1 hardware boundary; motor pulses still drive the same Box3D plant; mass, inertia, motor/prop dynamics, drag, battery model, sensor cadence and controller semantics are untouched by world selection.

Map geometry is **visual/geospatial context, not collision truth**. No building or map polygon is silently turned into a physics collider. The existing local collision/rangefinder world remains authoritative until a separately verified collision/elevation source is introduced. Likewise, OpenFreeMap vector data is not treated as a terrain-elevation measurement; local `z=0` remains the simulator launch plane.

Training mode performs no external map request. REAL WORLD fetches OpenFreeMap tiles only after the user explicitly chooses WORLD / USE MY GPS LOCATION.
