# Interaktiver Stromkreis (stromkreis.html)

## Goal
`stromkreis.html` explains Ohm’s law through a friendly control panel and animated circuit. Learners adjust voltage, resistance, and wire gauge to see current flow, LED brightness, and recommended safety settings update instantly.

## Conceptual flow
1. **Inputs** – Sliders for voltage (0–24 V), resistance (1–100 Ω), and cable length feed the simulation. Toggle switches turn the circuit on/off and enable auto-configuration.
2. **Core equation** – `updateCircuit()` computes current via `I = V / R`, power via `P = V * I`, and voltage drop along the cable. These values populate cards and progress rings.
3. **Visualization** – CSS animations move glowing dots along a wire path to indicate electron flow. Resistance controls change resistor color/width, and LED brightness adjusts based on calculated current.
4. **Safety checks** – `updateAWGRecommendation()` maps current and cable length to a recommended wire gauge and flags when the chosen setup exceeds safe limits.

## Layout cheat sheet
- **Controls panel**: grouped sliders and toggles with tooltips explaining each variable.
- **Visual panel**: schematic diagram with battery, resistor, LED, and animated current indicators.
- **Formula block**: highlights `V = I · R` plus derived quantities like power and voltage drop.
- **Explainer section**: narrative text reinforcing how changing resistance impacts brightness.

## Experiments
- Turn on auto-mode to let the app choose a safe resistance, then override it to see how overheating warnings appear.
- Lower resistance gradually and note how the flow animation speeds up while the LED glows brighter.
- Increase cable length to watch the recommended wire gauge jump, teaching why long runs need thicker wires.

## Developer pointers
- State is centralized in `circuitState`; `setControlsState()` keeps sliders and toggles synchronized when presets are loaded.
- Animations use CSS keyframes; adjust durations to represent different current scales.
- DaisyUI/Tailwind classes provide the modern look, so customizing colors is as simple as editing the CSS variables at the top.

This page makes Ohm’s law tactile: tweak a knob, watch the “electrons” speed up, and connect math to physical intuition.
