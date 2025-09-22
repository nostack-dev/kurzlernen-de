# DAW-X Engine (dawx.html)

## TL;DR
`dawx.html` is a standalone digital audio workstation experiment. It runs a deterministic drum-and-bass synthesizer entirely in JavaScript, favoring an AudioWorklet for low latency but shipping a ScriptProcessor fallback so it works everywhere.

## First principles core
1. **Global sample clock** – The engine treats the sample index `n` as truth. Beats are derived from `φ(n) = frac(n / samplesPerBeat)`, so every oscillator, envelope, and Euclidean rhythm stays sample-accurate without timers.
2. **Procedural sound** – Kick, snare, hat, and bass voices are generated mathematically in the worklet (`PhysEngine`). Oscillators use polyBLEP anti-aliasing helpers (`_saw`, `_square`) while noise hits pass through digital filters like `_hp()`.
3. **Deterministic randomness** – A simple xorshift RNG seeded in the config means “random” timbres repeat exactly when reseeded. That is crucial for reproducible patterns.
4. **Graceful degradation** – If `audioWorklet.addModule` fails, the UI spins up `PhysEngineDSP`, a class mirroring the same DSP logic and pumping audio via `ScriptProcessorNode`.

## Interface map
- **Transport panel**: `Start/Stop` buttons light an LED showing whether audio is live and reveal the selected engine (worklet vs fallback).
- **Tempo + seed controls**: update BPM, samples-per-beat, and RNG seed; `reseed` button rerolls textures instantly.
- **Voice editors**: each instrument has knobs/sliders for envelope, Euclidean step count/fill/rotation, and gain toggles.
- **Scope canvases**: draw time-domain waveforms of kick, snare, hat, and bass so you can “see” the sound.

## Fun explorations
- Disable the snare and increase the hat’s subdivision to hear shimmering polyrhythms.
- Switch the bass waveform to triangle, then crank the gate percentage to create staccato arpeggios.
- Drop the BPM while raising `snare.fill` to turn the patch into glitchy ambient noise.

## Developer notes
- The whole worklet source is embedded inside a `<script id="worklet">` tag and registered via `registerProcessor("phys-engine", ...)`.
- UI widgets are standard `<input>` elements; event handlers call `engineDSP.set(inst, key, val)` so the DSP state stays in sync for either backend.
- The oscilloscope uses `AnalyserNode` FFT data and `requestAnimationFrame` to continuously redraw.
- Because everything hinges on the sample counter, tempo changes reset phase to avoid drift between instruments.

This page doubles as a DSP tutorial: it starts with the raw physics of wave equations and ends with a live sequencer you can tweak like a DJ.
