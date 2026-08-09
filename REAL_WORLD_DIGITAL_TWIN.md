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

Production CI explicitly gates the 50 m range contract, 60 m navigation-ray coverage, WORLD visual cues, capped geospatial update rate, full-rate flight rendering, and FOLLOW/THIRD/FPV camera propagation before GitHub Pages deployment.

## WORLD navigation and camera ergonomics

The shared GAME horizontal speed command envelope remains **5 m/s** in Production, HIL and WASM until measured physical-airframe data justifies a retune. WORLD never multiplies physical speed for visual effect. The simulator instead runs the same 1 ms controller/physics step from a wall-time accumulator, independent of 60/120 Hz display refresh, with a bounded 50 ms catch-up window to avoid a post-stall spiral. Phone fineness/expo remains unchanged, so full stick reaches the full validated command envelope while centre stick remains precise.

WORLD settings include a **WORLD GRID** toggle, default ON. It reuses the simulator's existing local metric THREE grid as a render-only depth/scale cue above the geospatial map; it never becomes collision or navigation truth.

The top-right **MINI 3D · 360°** view is built from already-loaded MapLibre/OpenMapTiles vector features and one lightweight 2D canvas. It does not create a second MapLibre instance, WebGL renderer, tile stream or network request. Water, vegetation, roads and buildings use the same semantic colors as the main WORLD view; buildings are given a lightweight height projection for depth. **MINIMAP FOLLOWS 360° CAMERA** defaults ON; OFF keeps the mini-map north-up. Feature queries are capped at 1 Hz (2 s in critical performance mode), drawing at 8 Hz (4 Hz critical), and at most 80 cached features are retained.

## Human altitude command and render performance

The in-flight altitude UI is a spring-centred **CLIMB / HOLD / DESCEND** target-rate control, shared by one-phone and two-phone GAME input. It slews only the requested AGL setpoint (maximum 5 m/s target slew); releasing it returns the input to zero and therefore holds the current target. The target still crosses the normal SBUS channel and the production `StateController`; browser code never sets aircraft position, velocity, thrust or motor output. Small deadband and a progressive input curve make fine corrections possible without sacrificing full-range traversal.

The NAV range twin now permits the configured 60 m slant ray all the way through `groundRange`, so a 50 m AGL command remains measurable at the controller's 25° tilt envelope instead of being accidentally clipped by the former internal 50 m ray clamp. The NAV1 wire format remains unchanged.

WORLD rendering has a flight-first performance governor. The flight/FC/physics cadence is never reduced by it. Map camera refresh begins at 30 Hz and may drop to 20 or 15 Hz, and the flight overlay may drop to 1.0 device-independent pixel ratio, when measured visual frame rate is under pressure. It recovers only after sustained headroom. No building/flight geometry is silently substituted and no physical state is changed. Expensive label/icon symbol layers and backdrop blur are removed in WORLD; the map uses a one-time semantic palette (blue water, green vegetation, amber roads, light buildings) plus a compact legend for human scene parsing.

Altitude target slew is clocked by the control transport rather than rendering: 100 Hz SBUS sampling in one-phone SIM and the 20 ms P2P control publisher on the remote controller. Dropped visual frames therefore cannot change the intended height-control law.

Release CI also measures simulator-time versus browser wall-time at runtime, so display-refresh regressions cannot silently halve flight speed again. WORLD GRID is exercised both OFF and ON with persistence, and the semantic water/vegetation/road/building palette is locked by the browser release gate.


### Free look versus physical camera truth

In FOLLOW/THIRD, dragging empty WORLD space or the MINI 3D control applies a temporary presentation-camera yaw/pitch offset. With **KEEP 360° LOOK ORIENTATION** OFF, release snaps smoothly back; ON retains the released orientation. Aircraft pose, navigation, SBUS, motor commands and Box3D state are untouched, and the simulator camera is restored after each WORLD composite render. **FPV is excluded from free look entirely**: its optics remain rigidly mounted to the airframe exactly as the physical-camera contract requires.

The browser SIL fast path executes the exact same `fc::FirmwareRuntime` synchronously instead of inserting a JavaScript Promise boundary at every 1 ms control tick. Physical HIL remains asynchronous. Active physics parameters are read from the live PhysicsModel rather than from DOM controls at 1 kHz, and diagnostic DOM updates remain render-rate only. None of these optimizations changes control inputs, motor outputs, sensor bytes, physics integration, or model constants.

Realtime browser SIL preserves the physical authority path at 1 kHz: raw IMU generation, asynchronous SBUS/NAV1 arrivals, the exact compiled `fc::FirmwareRuntime`, motor-pulse output, motor/prop dynamics and Box3D integration at 1 ms with four solver substeps are unchanged. Race-HUD bookkeeping and downloadable diagnostic logging are sampled at 100 Hz, and RTT instrumentation at 50 Hz, because none of those observers feeds the controller or plant. `PhysicsModel.step()` no longer performs a redundant full-state readback that the realtime loop discarded; replay/fitting reads the resulting state after the requested integration duration.

The realtime scheduler treats display frames and simulation time as separate clocks. Exact 1 ms FC/raw-sensor/motor/Box3D steps are executed in bounded CPU work slices. When wall-time backlog remains, the scheduler yields main-thread ownership through `MessageChannel` without waiting an extra display frame; `requestAnimationFrame` is used only when the simulation has caught up. Physics dt, Box3D solver substeps, firmware cadence, sensor bytes, motor outputs and controller authority are unchanged. Release browser E2E requires measured simulator/wall cadence between 0.90x and 1.10x.
