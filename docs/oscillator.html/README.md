# Advanced 3D Oscillator Suite (oscillator.html)

## Overview
`oscillator.html` is a sprawling physics playground: three synchronized oscillators, layered trails, Fourier analysis, and sound synthesis all live in one page. It’s built with Three.js for visuals and the Web Audio API for ear candy.

## Core components
1. **Tabs as scenarios** – The control panel hosts three tabs, each representing a preset experiment. Switching tabs swaps oscillator parameters, audio settings, and visualization meshes.
2. **Layered oscillators** – Every tab controls green and yellow oscillators plus optional standing-wave and interference meshes. Global sliders adjust frequency, amplitude, and phase; layer-specific sliders fine-tune individual components.
3. **Phase locking** – `updatePhaseLocking()` enforces relationships like 1:2 or 3:5 between layers when the “phase lock” toggles are active. Changing the master slider automatically nudges dependents.
4. **Audio integration** – Each tab owns an `AudioContext`, oscillator nodes, and analyser. Starting playback pipes the synth through a `GainNode` whose output is visualized as a real-time bar graph.
5. **Trails and energy panels** – Trails store vertex buffers with fading colors. Energy distribution charts use analyser data to estimate kinetic/potential contributions for each axis.

## Interaction highlights
- **Control panel**: collapsible sections for oscillator parameters, visualization toggles, audio controls, and presets.
- **Canvas**: pointer drag rotates the camera; scroll zooms; a toggle button hides the control panel for distraction-free viewing.
- **Export hooks**: placeholders exist for saving presets—extend the `savePreset` function to serialize settings.

## Experiments
- Enable standing waves to see interference patterns build when phases align.
- Use the phase-locking matrix to create resonance (e.g., set yellow frequency to double green).
- Start audio playback and observe how the Fourier bars react to amplitude changes in real time.

## Developer notes
- UI events ultimately call `updateLayerSliders(layer, parameter)` to keep slider readouts synchronized with internal state.
- Visual meshes share geometries across tabs to reduce GPU overhead; only attribute buffers change.
- Audio analyzers allocate `Uint8Array` buffers per tab—reuse them if you add more tracks.

Treat this page as a digital lab bench: it mixes math, sound, and light so learners can experiment with oscillations holistically.
