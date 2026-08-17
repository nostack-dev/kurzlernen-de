# Real-world digital twin

The browser simulator has two world modes: **TRAINING RANGE** and **REAL WORLD · MY LOCATION**.

REAL WORLD is deliberately static/serverless. A user gesture requests high-accuracy browser geolocation, the WGS84 latitude/longitude becomes the horizontal origin of the existing local east/north/up metre frame, and the browser loads **Esri World Imagery** aerial/satellite pixels plus **OpenFreeMap / OpenStreetMap / OpenMapTiles** vector context. There is no account, API key, billing setup, application backend, proxy, or repository secret.

The real-world renderer uses MapLibre GL JS with the OpenFreeMap Liberty style. A public World Imagery raster source is inserted above the flat land-use polygons, while OSM transportation lines and the OpenMapTiles `building` layer remain as a lightweight hybrid overlay. Buildings are extruded from `render_height` and `render_min_height` when those OSM-derived values exist. The imagery layer is ON by default and can be disabled in Settings, with the original OSM vector rendering remaining as fallback.

The aircraft is rendered through the simulator's **existing THREE flight renderer and existing flight camera**. REAL WORLD does not create a second THREE WebGL renderer and does not hook the renderer prototype. Each simulator render frame explicitly gives the current renderer, scene and camera to the geospatial adapter; when WORLD is active, that same transparent flight canvas is composited over MapLibre. FOLLOW, THIRD and FPV therefore remain the simulator's normal camera modes rather than separate map-camera modes.

Flight truth remains unchanged: the exact shared firmware runtime still consumes the same raw ICM/SBUS/NAV1 hardware boundary; motor pulses still drive the same Box3D plant; mass, inertia, motor/prop dynamics, drag, battery model, sensor cadence and controller semantics are untouched by world selection.

Loaded OSM `building` polygons now have an explicit, bounded collision adapter. Polygon and MultiPolygon footprints are projected into the same local east/north/up metre frame, inner rings remain open courtyards, and `render_min_height`/`render_height` (or their available height equivalents) define the vertical span. A convex footprint becomes one static Box3D prism; only concave footprints and footprints with holes are triangulated into convex prisms. The existing airframe filter therefore sees walls and roofs, and the existing downward NAV range ray measures a roof rather than passing through it. RESET rebuilds the same snapshot in the new Box3D world; leaving WORLD removes it.

This is an **OSM-derived approximation, not surveyed 1:1 collision truth**. Source tiles can omit buildings, contain stale/inaccurate outlines or lack reliable heights. Processing is bounded to nearby loaded data (220 m radius, 192 footprint fragments and 512 convex prisms), deduplicates exact cross-tile repeats while preserving differently clipped fragments, and refreshes only after tile changes or meaningful aircraft movement. Terrain elevation is still not inferred from imagery or vector styling: local `z=0` remains the launch/ground plane. Roads, water, imagery and other map polygons remain render/geospatial context only.

Training mode performs no external map request. REAL WORLD fetches OpenFreeMap vector tiles and Esri imagery tiles only after the user explicitly chooses WORLD / USE MY GPS LOCATION.

## WORLD flight envelope and mobile visual budget

WORLD keeps the same controller and raw NAV1 boundary, but the GAME/solo AGL target envelope is **0.5–50.0 m**. NAV1 transports AGL as unsigned millimetres, so 50 m remains below its 65.535 m wire ceiling. The browser navigation twin uses a 60 m downward ground ray; with the controller's 25° maximum GAME tilt, a 50 m vertical AGL corresponds to about 55.2 m slant range and therefore remains inside that simulated sensor envelope. Raising the target beyond 50 m requires a verified longer-range/fused altitude source or a protocol change rather than silently fabricating sensor authority.

The aircraft/controller/Box3D loop is not throttled for map performance. THREE requests every display frame when the authoritative loop has headroom; presentation frames may be skipped only when measured physics backlog is under pressure. On every frame that is actually presented, MapLibre now receives the exact same camera eye, look direction, roll and vertical FOV as THREE. There is no separate 15/20/30 Hz map-camera clock and no map deadband that can leave the world behind the aircraft overlay. The visual budget instead uses a 1.0 hardware map pixel ratio (0.50 on detected software rasterizers), a 1.25 WORLD flight pixel-ratio cap, no MapLibre MSAA, a smaller tile cache depth and no explicit redundant repaint. WORLD also disables the flight shadow pass while the training ground is hidden, restoring it on return to TRAINING RANGE.

For human visual acquisition, WORLD uses a dark-blue sky/horizon instead of a black void, brighter 3D-building contrast, a more readable aircraft material palette and a thin WORLD-only cyan orientation halo around the aircraft in FOLLOW/THIRD. The halo is hidden in FPV. Those palette/halo cues are render-only; the separately bounded OSM building adapter above is the only map-derived Box3D collision path.

Production CI explicitly gates the 50 m range contract, 60 m navigation-ray coverage, OSM footprint extraction, real Box3D roof/wall contact, collider RESET/teardown, WORLD visual cues, presentation-frame geospatial registration, full-rate flight rendering, and FOLLOW/THIRD/FPV camera propagation before GitHub Pages deployment.

## WORLD navigation and camera ergonomics

The shared GAME horizontal speed command defaults to **10 m/s (36 km/h)** and is user-configurable up to the shared controller limit of **25 m/s (90 km/h)** in Production, HIL and WASM. WORLD never multiplies physical speed for visual effect. The simulator runs the same 1 ms controller/physics step from a wall-time accumulator, independent of 60/120 Hz display refresh. CPU work remains bounded to 50 ms per slice, while up to 2 s of foreground compositor debt is retained; any overflow is surfaced as a timing discontinuity instead of silently deleting physical time. Phone fineness/expo remains unchanged, so full stick reaches the configured physical command while centre stick remains precise.

WORLD settings include a **WORLD GRID** toggle, default ON. It reuses the simulator's existing local metric THREE grid as a render-only depth/scale cue above the geospatial map; it never becomes collision or navigation truth.

The top-right minimap stays strictly orthographic and top-down. It uses one lightweight 2D canvas, a bounded 48-tile imagery cache and the same World Imagery XYZ scheme as the main map; it does not create a second MapLibre or WebGL renderer. Cached OSM roads, water and flat building footprints are drawn as low-opacity orientation overlays instead of hiding the aerial pixels behind solid-color blocks. The minimap axis is north-up by default outside fullscreen, feature queries are capped at 1 Hz (2 s in critical mode), drawing at 8 Hz (4 Hz critical), and at most 80 vector features are retained.

### Camera reference-frame stability

The physical flight is identical in FPV, FOLLOW and THIRD: camera selection never enters the FC, sensors, motor commands or Box3D plant. Small hover corrections from the real navigation noise and controller are therefore retained as legitimate airframe motion rather than filtered out of physics.

Rendering now keeps previous/current 1 ms Box3D snapshots and interpolates one presentation pose from the fixed-step accumulator. That exact same pose drives both the visible aircraft and the selected flight camera. FPV remains rigidly attached to the interpolated airframe. FOLLOW and THIRD use a time-based, refresh-rate-independent inertial camera anchor with velocity prediction and a hard bounded lag. Crucially, camera eye and look target are derived from that same anchor. A small aircraft translation can therefore translate the complete external-camera frame but cannot rotate the world around the viewer while the camera catches up.

After optional WORLD free look is applied, MapLibre solves its camera from the final THREE eye/target pair in the same presentation frame for all three modes. CI quantitatively checks eye position, bearing and MapLibre/THREE screen-space registration and requires at most 1 px p95 error; a deliberately half-rate reference path must fail measurably. These changes are presentation-only and do not modify sensor noise, controller corrections, physics coefficients, collisions or flight timing.

## Human altitude command and render performance

The in-flight altitude UI is a spring-centred **CLIMB / HOLD / DESCEND** target-rate control, shared by one-phone and two-phone GAME input. It slews only the requested AGL setpoint (maximum 5 m/s target slew); releasing it returns the input to zero and therefore holds the current target. The target still crosses the normal SBUS channel and the production `StateController`; browser code never sets aircraft position, velocity, thrust or motor output. Small deadband and a progressive input curve make fine corrections possible without sacrificing full-range traversal.

The NAV range twin now permits the configured 60 m slant ray all the way through `groundRange`, so a 50 m AGL command remains measurable at the controller's 25° tilt envelope instead of being accidentally clipped by the former internal 50 m ray clamp. The NAV1 wire format remains unchanged.

WORLD rendering has a flight-first performance governor. The flight/FC/physics cadence is never reduced by it. The flight overlay may reduce its device-independent pixel ratio when measured visual frame rate is under pressure and recovers only after sustained headroom. Map-camera registration is never decimated: it follows each frame that is actually presented so the aerial world and THREE overlay cannot drift into different visual reference frames. Building collision extraction/rebuild is separately throttled and bounded; it never changes FC, motor or timestep authority. Expensive label/icon symbol layers and backdrop blur are removed in WORLD; asynchronous raster tiles are composited beneath the thin OSM road/building overlay and never block the 1 kHz authority loop.

Altitude target slew is clocked by the control transport rather than rendering: 100 Hz SBUS sampling in one-phone SIM and the 20 ms P2P control publisher on the remote controller. Dropped visual frames therefore cannot change the intended height-control law.

Release CI also measures simulator-time versus browser wall-time at runtime, so display-refresh regressions cannot silently halve flight speed again. WORLD GRID and aerial imagery are each exercised OFF and ON with persistence; the browser gate requires the imagery layer and the independent top-down minimap imagery cache without granting either one physics authority.


### Free look versus physical camera truth

In FOLLOW/THIRD, dragging empty WORLD space or the MINI 3D control applies a temporary presentation-camera yaw/pitch offset. With **KEEP 360° LOOK ORIENTATION** OFF, release snaps smoothly back; ON retains the released orientation. Aircraft pose, navigation, SBUS, motor commands and Box3D state are untouched, and the simulator camera is restored after each WORLD composite render. **FPV is excluded from free look entirely**: its optics remain rigidly mounted to the airframe exactly as the physical-camera contract requires.

The browser SIL fast path executes the exact same `fc::FirmwareRuntime` synchronously instead of inserting a JavaScript Promise boundary at every 1 ms control tick. Physical HIL remains asynchronous. Active physics parameters are read from the live PhysicsModel rather than from DOM controls at 1 kHz, and diagnostic DOM updates remain render-rate only. None of these optimizations changes control inputs, motor outputs, sensor bytes, physics integration, or model constants.

Realtime browser SIL preserves the physical authority path at 1 kHz: raw IMU generation, asynchronous SBUS/NAV1 arrivals, the exact compiled `fc::FirmwareRuntime`, motor-pulse output, motor/prop dynamics and Box3D integration at 1 ms with four solver substeps are unchanged. Race-HUD bookkeeping and downloadable diagnostic logging are sampled at 100 Hz, and RTT instrumentation at 50 Hz, because none of those observers feeds the controller or plant. `PhysicsModel.step()` no longer performs a redundant full-state readback that the realtime loop discarded; replay/fitting reads the resulting state after the requested integration duration.

The realtime scheduler treats display frames and simulation time as separate clocks. Exact 1 ms FC/raw-sensor/motor/Box3D steps are executed in bounded CPU work slices. When wall-time backlog remains, the scheduler yields main-thread ownership through `MessageChannel`; when caught up, a simulation deadline timer waits for the next physical tick rather than coupling authority to `requestAnimationFrame`. Physics dt, Box3D solver substeps, firmware cadence, sensor bytes, motor outputs and controller authority are unchanged. Release browser E2E requires measured simulator/wall cadence between 0.97x and 1.03x, zero timing discontinuity, and recovery after an injected 400 ms compositor stall.

### Flight-first presentation budget

Browser SIL treats visual work as an observer with an explicit CPU/GPU budget. The authoritative path remains exact 1 ms raw-sensor → `fc::FirmwareRuntime` → motor-pulse → motor/prop → Box3D execution. HUD refresh is capped at about 13 Hz, continuous motor-audio parameter refresh at 20 Hz, and hardware-WebGL shadow-map refresh at 4 Hz while the normal image renderer remains adaptive; WebGL uses the lower-cost basic shadow sampler so shadow presentation cannot dominate the 1 kHz authority path. When measured simulation backlog grows, presentation frames are skipped before any physical tick is skipped; a 48 ms maximum draw deadline avoids the 60 Hz floating-point boundary falling through to a fourth refresh. On hardware with headroom the renderer still runs at display cadence. Neither the presentation governor nor WORLD rendering changes `DT`, controller constants, sensor cadence, motor outputs, mass/inertia/drag, or Box3D integration.


### Restart ownership and adaptive visual resolution

STOP / RESET / START uses a monotonic run epoch. A loop from an older epoch cannot resume after a new run begins, including across `requestAnimationFrame`, `MessageChannel`, or asynchronous HIL waits. This prevents two 1 kHz schedulers from ever sharing the same FirmwareRuntime/Box3D authority after an immediate restart.

Visual resolution is a production presentation governor, not a simulation time-scale. The THREE renderer omits MSAA; hardware-accelerated WebGL starts at up to 1.25 CSS pixel ratio and measures authoritative simulator-time versus wall-time in 250 ms windows. A browser that reports a software rasterizer such as SwiftShader or llvmpipe starts at a dedicated 0.30 CI/fallback backbuffer ratio, additionally disables tone-mapping/shadow work, and remains uncapped at `requestAnimationFrame` cadence; the former artificial 16–17 fps ceiling was visibly jerky and has been removed. Hardware WebGL keeps the normal display-rate/adaptive draw path and never uses the software-only 0.30 ratio. On hardware WebGL, only measured presentation pressure may step the THREE backbuffer down to 0.80 and ultimately 0.60, and sustained headroom is required before resolution recovers. REAL WORLD uses a 0.75 flight-overlay floor only in its critical visual-pressure tier while retaining frame-synchronous map-camera registration. None of these paths changes the 1 ms timestep, sensor cadence, FC code, motor pulses, plant parameters, collision, or Box3D solver work.

### Physical-model validation status

Nominal mass/inertia/motor/prop/battery coefficients are explicitly **UNVALIDATED**. REAL LOG identification fits only the first 70% of an ordered measured flight. The last 30% is an unseen chronological holdout initialized from one shared boundary state; its residuals never influence the fitted coefficients. A model receives `HOLDOUT VALIDATED` only when duration and motor-excitation coverage pass and position, velocity, attitude, yaw, battery and current RMSE all pass the physical-unit limits in `sim/physics_validation.mjs`. The exported flight log carries both this report and scheduler discontinuity/frame-pacing evidence.

Passing means only “validated to the recorded tolerances inside this measured airframe/flight envelope.” It is not a claim of mathematical identity, terrain truth, ESP32-S31 cycle accuracy, or extrapolation beyond the log. Changing any physical or environment parameter immediately returns the UI to `UNVALIDATED`.


### Fullscreen and grid ownership

Fullscreen/orientation is presentation state only. A browser dropping fullscreen must not exit SOLO, clear the arm request, stop the scheduler, or alter FC state. Flight termination remains explicit (`EXIT` / `KILL`) or comes from the real shared FC safety path.

`DEBUG GRIDLINES` and `WORLD GRID` are intentionally separate renderer controls. Debug gridlines default OFF and affect only the training renderer. WORLD GRID remains an independent local-metre orientation overlay in REAL WORLD. Neither grid participates in navigation measurement, collision, controller state, motor output, or Box3D physics.
