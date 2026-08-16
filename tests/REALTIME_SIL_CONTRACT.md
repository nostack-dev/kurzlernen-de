# Realtime SIL release contract

Browser SIL is acceptable only when the exact shared firmware/controller and the 1 ms motor/Box3D plant track wall time near 1x without time scaling, dropped physical ticks, enlarged physics steps, or altered controller authority. Rendering, map updates, diagnostics, logging and race bookkeeping are non-authoritative and may be budgeted independently to protect flight execution.

The release browser E2E enforces a measured simulator/wall-time cadence of 0.97x–1.03x, zero silently discarded wall time, recovery after an injected 400 ms main-thread/compositor stall, and renderer-class-aware presentation pacing. The 1 kHz scheduler waits on its own physical deadline timer when caught up; it never waits for a display frame.

Nominal plant parameters are not release evidence. Physical-model acceptance requires a chronological 70/30 identification/holdout split and physical-unit RMSE gates for position, velocity, attitude, yaw, battery voltage and current. Missing channels, insufficient duration/excitation, overfit, or a parameter change keeps the model explicitly `UNVALIDATED`.
