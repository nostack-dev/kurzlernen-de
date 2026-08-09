# Realtime SIL release contract

Browser SIL is acceptable only when the exact shared firmware/controller and the 1 ms motor/Box3D plant track wall time near 1x without time scaling, dropped physical ticks, enlarged physics steps, or altered controller authority. Rendering, map updates, diagnostics, logging and race bookkeeping are non-authoritative and may be budgeted independently to protect flight execution.

The release browser E2E enforces a measured simulator/wall-time cadence of 0.90x–1.10x.
