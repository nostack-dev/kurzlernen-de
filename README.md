# Kurzlernen Knowledge Base

Welcome! Kurzlernen is a static playground of interactive learning experiments.
This combined README stitches together the playful per-file guides stored in the `docs/` directory so you can browse everything from one place.
If you prefer the original short description, it now lives right below this intro.

---

## Quick blurb

Static website with interactive educational pages. Built and deployed via GitHub Pages.

---


## Cardio Log (cardio.html)

## Elevator pitch
`cardio.html` is a single-page workout journal that feels like a tiny game. It lets multiple users log cardio sessions, sprinkles in confetti when goals are hit, and keeps everything stored locally so progress sticks between visits.

## First principles tour
1. **State** – Every dropdown, slider, and table row is driven by a JavaScript state object. The helper `loadState()` pulls it from `localStorage`, and `saveState()` writes back whenever something changes.
2. **Energy model** – Workouts are stored as watt-based intervals. The helper `getWattValue(level)` translates the quick-entry slider level into watts, and `calculateCalories()` uses body weight and duration to estimate burned energy.
3. **Feedback loop** – Actions funnel through friendly dialogs like `showConfirmDialog()` and `showSuccessDialog()`. Both wire up confetti via `createConfetti()` to make achievements feel celebratory.

## Page anatomy
- **Header row**: shows the page title, theme switcher (Tailwind + DaisyUI themes), and quick user selection.
- **User settings**: body weight and weekly target inputs store personal data in the same shared state.
- **Quick-entry card**: a range slider for watt level, preset duration buttons, and “Log Session” call-to-action for rapid capture.
- **Statistics bar**: mini cards summarizing weekly totals, daily streaks, and calorie output.
- **Sessions table**: responsive table with edit/delete actions and highlight animation for new rows.

## Try-it-yourself challenges
- Add a new quick-entry button that logs a “cool-down” five-minute session at low wattage.
- Swap the DaisyUI theme to `dracula` and watch the entire interface restyle instantly.
- Change the weekly target to trigger the gamified progress indicators.

## Developer notes
- All persistent data lives under the keys `z2-cardio-state` and a generated `deviceId` in `localStorage`.
- Confetti elements are generated dynamically and removed after animations, so the DOM stays lean.
- The table is wrapped in `.sessions-table-container` to keep it scrollable on narrow screens.
- Responsive tweaks kick in at `max-width: 420px`, hiding non-essential columns to keep mobile usage pleasant.

In short, `cardio.html` is a joyful quantified-self logger that blends spreadsheets, party poppers, and progressive enhancement into one playful page.


## Circles & Lines Playground (circles.html)

## Quick summary
This page is a geometry sandbox: drag to draw circles, right-click-drag to lay down lines, and tweak a grid to explore compass-and-straightedge constructions with modern mouse gestures.

## First principles breakdown
1. **Coordinate capture** – Mouse events track screen coordinates (`clientX/Y`) and convert them into CSS positions. Every circle stores its center and radius so it can be redrawn precisely after undo/redo operations.
2. **State history** – A plain JavaScript array acts as an undo stack. Each drawn element is recorded with its class name and inline styles. `redrawFromHistory()` rebuilds the DOM by replaying that stack.
3. **Vector math** – When you drag the live line or circle, the code uses `Math.atan2` and `Math.hypot` to convert raw distances into angles and lengths. That keeps rendered lines and radius handles consistent even after panning or scaling.

## How to play
- **Left click + drag**: define the center of a new measuring circle. Hold `Alt` to instantly stamp a circle using the last radius.
- **Right click + drag**: draw straight lines between two points. Middle click enables viewport panning to explore large constructions.
- **Ctrl + drag on a circle**: resize it interactively. Each circle gets a red handle you can tug for fine adjustments.
- **Grid controls**: buttons in the corner nudge the spacing in five-pixel increments so you can align shapes precisely.
- **Undo/redo**: revisit your steps like in a drawing app—the script replays every stored element.

## Fun experiments
- Recreate a Euclidean triangle construction and then overlay the circumcircle using the circle handle.
- Increase the grid size dramatically to simulate zooming out, then use the panning gesture to navigate.
- Mix circles and red vectors to visualize complex-number addition: each vector is just a one-pixel-wide div rotated into place.

## Developer notes
- The layout relies on absolutely positioned `<div>` elements (`.circle`, `.line`, `.vector`) layered inside a full-screen container.
- The `fixedPoint` marker and ghost preview circle are reusable UI aids that appear while dragging.
- No canvas is used—everything is DOM-based, making CSS-based styling or exporting to SVG straightforward.

This file turns geometry class into a tactile playground where lines and arcs obey the math you learned from first principles.


## CNAME File Guide

## What is this file?
The `CNAME` file is a single-line text file that tells GitHub Pages which custom domain should point to this repository. In our case it contains the domain `kurzlernen.de`, so GitHub knows to serve the site when someone types that address into their browser.

## Why it matters (from first principles)
Domain Name System (DNS) records map human-friendly names like `kurzlernen.de` to numeric IP addresses. GitHub Pages automatically hosts sites under `<username>.github.io`, but if we want to use our own domain we must register it and then prove to GitHub which domain belongs to this repository. The simplest proof is this `CNAME` declaration. When GitHub builds the site, it reads this file and configures its edge servers to respond to `kurzlernen.de` instead of the default address.

## Fun mental model
Think of the `CNAME` file as a VIP guest list. GitHub is the bouncer who only lets domains on the list access the private party (our website build). Without the `CNAME`, visitors would be directed to the generic entrance and our custom banner would never appear.

## Editing tips
- The file must contain only the domain name and nothing else—no protocol (`https://`) and no trailing spaces.
- If you ever change domains, update this file and adjust your DNS provider’s `CNAME` record to point to `<username>.github.io`.
- Deleting the file reverts the site back to the default GitHub Pages domain.

## Quick checklist
- [x] Custom domain registered with a DNS provider.
- [x] DNS provider has a `CNAME` record pointing to `kurzlernen.github.io` or similar.
- [x] This repository contains the matching `CNAME` file.

Keep this tiny file safe—without it the rest of the project would only shine on the default GitHub Pages address!


## DAW-X Engine (dawx.html)

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


## Touch Position Verification Tool (draw.html)

## Overview
`draw.html` is a lab instrument for tablets and touchscreens. It renders a full-screen SVG canvas and tracks every finger, showing live coordinates and trails so you can verify hardware accuracy or debug multi-touch gestures.

## Mechanics from first principles
1. **Pointer capture** – The page listens to `touchstart`, `touchmove`, `touchend`, and `touchcancel` events on the `<svg>` element. Default gestures (`touch-action`) and text selection are disabled so raw coordinates come through untouched.
2. **Vector display** – Each active touch spawns a `<circle>` inside the `#touchPoints` group. Radius and opacity reflect movement, and the `data-touch-id` attribute ties DOM nodes to the browser’s `identifier` property.
3. **Logging** – Every touch event is logged into `#debugWindow`. The toggle button simply adds or removes the `.show` class so testers can review the scrollable event stream without cluttering the UI.

## UI landmarks
- **Instructions overlay** reminds you which gestures to try.
- **Debug button** in the top-right corner opens the event console.
- **SVG grid**: background shading makes it easy to eyeball drift as you move.

## Experiments to try
- Perform a five-finger pinch and watch the circles shrink toward a common center.
- Hold one finger still while drawing with another to confirm separate touch IDs update independently.
- Toggle the debug window and copy the JSON-like logs into a bug report.

## Developer nuggets
- Because everything lives in SVG, exporting a screenshot with `toDataURL` would be straightforward if needed.
- The code intentionally uses `passive: false` on event listeners so it can call `preventDefault()` and avoid scrolling.
- Touch points fade out by removing them during `touchend`; add easing or trails by storing previous positions in an array.

This page turns invisible finger data into bright circles so you can reason about touch input from the hardware layer up.


## Sinus Vector Explorer (extrema.html)

## What it is
`extrema.html` visualizes how a sine wave emerges from a rotating vector. Sliders adjust the vector’s horizontal (period) and vertical (amplitude) components, and the canvas draws both the resulting wave and the vector that generates it.

## First principles refresher
1. **Vector rotation** – `rotateVector(x, y, angle)` converts slider values into a rotated basis using the classic rotation matrix `[cos θ, -sin θ; sin θ, cos θ]`.
2. **Sampling the wave** – `generateSinusFromVector` computes evenly spaced x-values from `-2π` to `2π` and evaluates the sine function with the rotated amplitude and period. This mirrors the formula `y = A sin(2πx / T)`.
3. **Rendering** – The canvas is cleared each frame, axes are redrawn, and the blue sinusoid is plotted by mapping mathematical coordinates to screen space. The red vector extends to the first peak (period/4) so students can compare vector length and wave amplitude directly.

## Guided tour
- **X-Komponente slider** manipulates the effective period: shorter values compress the wave, longer values stretch it.
- **Y-Komponente slider** controls amplitude: higher values create taller peaks and deeper valleys.
- **Rotation slider** spins the underlying vector while updating the on-screen value readout.

## Learning games
- Set the rotation to 90° and notice how the x- and y-components swap roles, flipping the wave’s phase.
- Try matching a desired period (e.g., two cycles across the canvas) by adjusting the x-component.
- Challenge students to predict the coordinate label displayed next to the red vector before it updates.

## Implementation tidbits
- Canvas scaling is handled manually: x-values scale by `width / (4π)` and y-values by `height / 4` to keep everything centered.
- Slider events are bound with `input` listeners so updates feel immediate.
- Because everything is computed fresh each draw, you can add overlays (derivative curves, tangent lines) by extending `drawSinusCurve()`.

This file turns trigonometry into an interactive toy where vectors, waves, and rotations dance together.


## Rotating Sinus Lab (extrema_rotation.html)

## What sets this variant apart?
`extrema_rotation.html` is a classroom-ready clone of the sinus explorer with emphasis on the rotation slider. It highlights how rotating a base vector changes both period and amplitude simultaneously, making phase shifts tangible.

## System model
1. **Input vector** – Sliders start with `(2, 1)` as the unrotated vector. That corresponds to a period of `2 * 4 = 8` units and amplitude `1`.
2. **Rotation transform** – The `rotateVector` helper applies the standard 2D rotation matrix, producing the coordinates actually used to compute the wave. These rotated values are fed back into the slider readouts so students immediately see the numerical effect.
3. **Wave generation** – `generateSinusFromVector` samples 500 points from `-2π` to `2π`, multiplies them by the rotated period, and maps the results to canvas pixels.

## Teaching checklist
- Draw attention to the red vector anchored at the canvas center. Its length and orientation mirror the rotated vector driving the sine curve.
- Use the rotation slider to show phase shifts: at 180° the sine flips vertically, at 270° the amplitude appears negative.
- Pause at 45° and ask learners to compute the expected components before revealing the displayed `(x, y)` label.

## Customization ideas
- Increase `points` in `generateSinusFromVector` for smoother lines if you ever expand the canvas width.
- Change the baseline by editing the slider `min`/`max` values to explore extreme amplitudes or micro periods.
- Add derivative curves or shaded extrema by extending `drawSinusCurve()`—the structure leaves plenty of room.

## Implementation notes
- All event listeners use `input` events so the wave updates continuously as the slider moves.
- The canvas axes are redrawn each frame; extracting them into a helper would make it easier to add grid lines or labels.
- Because period is derived as `xKomponente * 4`, the default vector ensures one full sine cycle fits nicely into the viewport.

Use this page when you want students to *feel* the algebra behind sinusoidal rotations, not just memorize formulas.


## Optimized 3D Fluid Simulation (fluids.html)

## Snapshot
This page renders a pseudo-3D particle fluid simulation entirely on the GPU using WebGL. Thousands of particles flow inside a cubic box while sliders let you tune viscosity, damping, and pressure stiffness in real time.

## Physics from first principles
1. **Particles** – Each fluid parcel is a `Particle` instance with position, velocity, and color state. The initializer distributes them evenly across a grid, giving every cell a starting direction.
2. **Advection** – `streamParticles()` advances positions by velocity each frame (`p.position += p.velocity * dt`). Boundary checks bounce particles off the cube walls by inverting velocities.
3. **Collisions & pressure** – Density is accumulated via `mapParticlesToGrid()`. `applyPressureForces()` compares each particle’s density to neighboring cells, nudging it away from overcrowded regions. The `pressureSlider` scales those forces.
4. **Viscosity** – `applyViscosity()` dampens velocity magnitude in smooth regions and re-randomizes direction when counts exceed the `viscosityThreshold`. That mimics how honey-like fluids resist shear.

## Rendering pipeline
- WebGL shaders draw each particle as a glowing point (`gl_PointSize = 8.0`).
- The projection + model-view matrices orbit the camera slowly so the cloud appears three-dimensional.
- Colors encode velocity magnitude—fast-moving particles glow warm, slower ones cool.

## Controls at a glance
- **Viscosity Threshold**: how many particles must share a cell before the sim smears them together.
- **Damping Factor**: scales velocity retention each frame (`velocity *= damping`).
- **Pressure Stiffness**: increases repulsion in dense zones, preventing clumping.
- **Reset Simulation**: reinitializes particles with the latest parameter settings.

## Experiments
- Drop the damping to 0.5 and watch the fluid become energetic and chaotic.
- Raise viscosity to freeze sections into thick blobs—perfect to explain laminar vs turbulent flow.
- Pause the orbiting camera by setting `rotationSpeed` to zero (search for the `rotationSpeed` constant) to examine internal structure.

## Implementation hints
- The simulation runs inside an animation loop capped with `requestAnimationFrame` and `performance.now()` time steps.
- Physics and rendering share the same `particles` array, so you can easily expand `Particle` with temperature or pressure visuals.
- WebGL buffer updates stream positions every frame; consider using instanced rendering if you raise the particle count dramatically.

This file is a mini fluid dynamics lab: tweak the knobs, observe emergent behavior, and connect slider math to real-world viscosity and pressure concepts.


## Enhanced IFS Fractal Generator (fractals.html)

## Big idea
This page builds fractals using Iterated Function Systems (IFS). You control up to four affine transformations, assign probabilities, choose colors, and then let a Web Worker crunch millions of points that paint onto a canvas you can zoom and pan.

## Under the hood
1. **Affine transforms** – Each transformation is represented by sliders `a` through `f`, encoding the matrix `[a b; c d]` and translation `(e, f)`. These define how points are scaled, skewed, rotated, and moved.
2. **Probability selection** – Because each iteration randomly picks a transformation, the `probabilities` panel ensures the sum equals 1. The UI auto-normalizes your inputs.
3. **Web Worker acceleration** – The heavy lifting happens off the main thread. A blob-based worker receives the transformation set, generates point batches, and posts them back. The main thread draws them with `ImageData` for speed.
4. **Color gradients** – Each transformation has an associated color. During plotting, the worker blends colors across iterations, letting fern leaves fade from bright tips to shadowed stems.

## Interface landmarks
- **Transform cards**: enable/disable transformations, adjust matrices, and preview their effect.
- **Probabilities section**: quick buttons to equalize weights or randomize them for exploration.
- **Color palette**: pick base hues, shuffle them, or load presets like Barnsley Fern or Sierpinski triangle.
- **Export options**: download PNGs, save parameter JSON, or copy shareable presets.
- **Advanced insights**: live statistics show bounding boxes, iteration counts, and runtime.

## Playful experiments
- Start with the Barnsley preset, then slightly tweak translation values to morph the fern into alien plants.
- Turn off one transformation to see how the attractor collapses and why each map is essential.
- Enable “auto zoom” to let the viewport follow the fractal’s bounding box as it evolves.

## Implementation hints
- The canvas uses `requestAnimationFrame` while dragging for smooth pan/zoom interactions, then snaps back to normal rendering.
- Worker messages contain typed arrays for performance; keep them small if you add more metadata.
- Animation controls are scaffolded but intentionally left unimplemented—great stretch goal if you want to interpolate between presets.

Fractals emerge from simple linear algebra plus randomness. This tool invites you to tweak those primitives until stunning self-similar art appears.


## Story Hub Landing & Generator (geschichte.html)

## Narrative overview
`geschichte.html` is a full marketing funnel for an AI audio storytelling product. It starts with a glossy landing page (hero, pricing tiers, testimonials) and transitions into a hands-on story generator where visitors can enter prompts, synthesize narration, and download the result.

## Architecture tour
1. **Tailwind + DaisyUI** – Styling is handled via CDN imports, letting the page adopt the `forest` theme with minimal CSS. Components like cards, buttons, and collapses come straight from DaisyUI classes.
2. **Page switching** – `showPage('landing' | 'generator')` toggles `hidden` classes between the hero/pricing section and the generator UI. Smooth scrolling keeps navigation delightful.
3. **Prompt workflow** – When you click “Geschichte erstellen & anhören,” the script gathers the textarea value, builds a JSON payload, and sends it to the configured API endpoint via `fetch`.
4. **Status feedback** – While waiting, a progress bar and status text appear. On success, the returned story HTML populates `#story-text` and an audio URL feeds the `<audio>` player. Errors trigger toast notifications in `#message-box`.

## Key sections
- **Hero**: bold typography, call-to-action buttons, and background pattern.
- **Pricing grid**: three cards (Einzelkauf, Monatsabo, Autoren-Paket) with bullet lists and purchase buttons.
- **Generator card**: prompt textarea, generate button, loading indicators, result collapsible, and audio controls.
- **Feature highlights**: badges tout AI voice quality, editing tools, and concierge service.

## Try this at home
- Swap the `data-theme` attribute from `forest` to `night` for a gothic vibe.
- Modify the `apiUrl` constant to point to your own backend for rapid prototyping.
- Add testimonials by cloning the existing card markup inside the features section.

## Implementation pointers
- Toasts are created via `showToast(message, type)` which injects DaisyUI alert markup and auto-hides it after 4 seconds.
- `handleStoryGeneration()` manages state toggles for loading and result containers; reuse it if you add more asynchronous calls.
- Remember to secure API keys—`fetch` currently expects the backend to handle authentication.

This file blends marketing polish with an interactive demo so visitors can go from curiosity to created story in minutes.


## Rubbellos-Leiter Pro (glitch.html)

## Concept
This dashboard models a “ladder” strategy for scratch-off lottery tickets. It tracks bankroll, safe withdrawals, Pfand (deposit bottle) reinvestments, and net loss across rounds—all stored offline so users can experiment with risk scenarios.

## Mechanics from first principles
1. **State machine** – A `state` object keeps arrays of rounds, KPIs, and the active session flag. A dictionary of `STORAGE_KEYS` lets Normal and Pfand modes persist separately in `localStorage`.
2. **Mode switching** – Changing the `<select id="modeSelect">` toggles Pfand-specific inputs and rehydrates state from the corresponding storage key. The UI updates KPIs and the history table instantly.
3. **Round progression** – Buttons “Einsatz gewonnen” and “Verloren” append round data with stake, winnings, delta, and updated totals. Business rules enforce when the safe bank grows vs when the play bank absorbs losses.
4. **Visual feedback** – Tailwind utility classes create KPI cards, pill badges for current status, and a history table showing every round with trend arrows.

## Feature highlights
- **Session control**: start/end buttons prevent accidental logging outside an active series.
- **Pfand helper**: in Pfand mode the app converts bottle counts to euro stakes using the rule printed below the input.
- **History timeline**: a responsive table with per-round notes, automatically sorted newest-first.
- **Dashboard badges**: highlight hot streaks (three wins), cold streaks, or break-even points.

## Experiment ideas
- Start with €10, toggle to Pfand mode, and see how the safe bank accumulates after each win.
- Simulate a losing streak and observe how the ladder rebuilds by reducing stake sizes.
- Reset the session and inspect the storage key in DevTools (`localStorage['rubbellos-ladder-normal']`).

## Implementation nuggets
- `save()` writes the entire state after every mutating action; `load()` gracefully handles empty storage by returning defaults.
- KPI numbers are formatted via `formatCurrency()` ensuring consistent two-decimal output.
- The script leans on pure functions for calculations (`calculateStake`, `calculateSafeTransfer`), making it easy to adjust strategy rules.

This page gamifies bankroll management so math-minded players can explore probabilities without risking real money.


## Kurzlernen Mission Control (index.html)

## Purpose
`index.html` is the flagship learning companion. It guides a learner through three daily tasks—reading aloud, handwriting practice, and math drills—while tracking progress, capturing evidence, and rewarding completion.

## System breakdown
1. **Task model** – `storedTasks` keeps per-task state: recorded audio, uploaded handwriting proof, generated math problems, completion flags, and submission status. Everything is serialized to `localStorage` so sessions survive page reloads.
2. **Timers + flow** – Each task has start/stop buttons. `startTask()` enforces that only one task runs at a time, while `startTimer(taskIndex)` drives countdowns and progress bars. On completion, `checkAllTasksCompleted()` unlocks the final submission step.
3. **Media capture** – Task 1 uses `navigator.mediaDevices.getUserMedia` and RecordRTC to record speech. Task 2 accepts image uploads (handwriting proof) and stores them as base64 strings. JSZip + FileSaver bundle results for download when submitting.
4. **Content seeding** – `initializeTasks()` seeds rich story text for reading, a copywork paragraph, and generates 10 math exercises (5 multiplication, 5 division) with integer answers.
5. **User experience** – DaisyUI components (cards, badges, progress bars) deliver a playful UI; a theme toggle flips between light/dark, and the 💩 button plays a celebratory fart with particle animation.

## How learners interact
- Hit “Start Lesen & Aufnahme” to begin recording; timers and modals guide the flow.
- Upload a handwriting photo; the page previews it and marks the task complete.
- Solve math problems once Task 3 unlocks; answers validate in real time and persist.
- When all tasks are green, submit to generate a downloadable archive and lock the interface.

## Developer hints
- Compatibility checks ensure MediaRecorder and JSZip exist; fall back gracefully for unsupported browsers.
- Toasts and modals reuse helper functions (`showToast`, `showValidationModal`) for consistent feedback.
- To localize, adjust the initial text constants or fetch from `texts.json` (see that file’s README for context).

This page orchestrates audio, images, and math logic to make home study feel like a game backed by solid engineering fundamentals.


## ops.impact Landing Page (landing.html)

## Mission
`landing.html` introduces the ops.impact coaching program. It’s a polished marketing page with responsive navigation, storytelling sections, and a contact call-to-action tailored for leadership culture work.

## Layout tour
1. **Navigation** – Sticky header with desktop links and a mobile hamburger. The script toggles the mobile menu’s `hidden` class for a smooth slide-down experience.
2. **Hero** – Gradient text headline, supporting copy, and call-to-action buttons that scroll to the program and contact sections.
3. **Program pillars** – Cards describe modules (Identität, Kultur, Führung, Klarheit) with checklists and icons.
4. **Essenz & Vorgehen** – Split sections using Tailwind grids to explain methodology, including timeline steps and supportive imagery placeholders.
5. **Testimonials** – Quote cards give social proof, styled with soft shadows and accent colors.
6. **Kontakt** – Form with name, email, and message fields plus a “Fein abgestimmt” promise list.

## Principles at play
- **Tailwind config** extends the color palette to match the brand. Everything else uses utility classes—no custom CSS frameworks required.
- **Sticky CTA** ensures the “Gespräch anfragen” button stays visible on large screens.
- **Semantic structure** (sections, headers, lists) keeps accessibility in mind while reinforcing the narrative flow from problem to solution.

## Experiments
- Swap out the accent colors in the Tailwind config to rapidly prototype different brand palettes.
- Hook the contact form to your backend or Zapier webhook—look for the `<form id="contact-form">` to add event listeners.
- Add subtle scroll-based animations by applying Tailwind’s `transition` utilities and toggling classes on intersection observers.

## Developer notes
- The page uses Google Fonts’ Inter family for consistent typography across sections.
- Mobile/desktop nav share anchor targets; update section IDs if you rename headings.
- For SEO, adjust the `<meta name="description">` to reflect the latest messaging.

This landing page is essentially a narrative arc: attention → insight → proof → invitation. Tweak the content blocks and you have a ready-made marketing funnel.


## Classic IFS Fractal Generator (noise.html)

## Overview
`noise.html` is the original iterated function system explorer. It renders fractals point-by-point on a canvas while letting you tweak up to three affine transformations and their probabilities.

## Mechanics
1. **Affine maps** – Sliders labelled A–F define transformation matrices just like in the enhanced version. Each transform can be toggled individually, allowing quick experiments with fewer functions.
2. **Random iteration** – `generateIFSFractal()` seeds a starting point and repeatedly applies a randomly selected transformation according to the probability sliders. The resulting coordinates are scaled into canvas space and plotted as single pixels.
3. **Zoom controls** – Buttons adjust a zoom factor and translation offsets, letting you dive into fractal detail without recomputing parameters.
4. **Color themes** – Each transformation has a fixed color assignment. Blending is minimal, giving crisp triangular or fern-like patterns.

## Interface highlights
- **Transform panels**: a concise UI without the advanced sections from `fractals.html`, ideal for teaching fundamentals.
- **Probability sliders**: normalized automatically to sum to 1; a text indicator confirms the total.
- **Reset + randomize**: one-click ways to explore new shapes quickly.

## Suggested activities
- Disable all but one transformation to see how linear maps alone stretch the starting point.
- Gradually reintroduce additional transforms to watch the attractor emerge.
- Play with extreme shear values to create glitch-art effects.

## Developer tips
- The rendering loop is synchronous; for millions of points consider adding a Web Worker (see the enhanced version for inspiration).
- Canvas resizing is manual—adjust width/height attributes for higher resolution exports.
- Because colors are basic, this is a good base for teaching palette generation or depth shading.

Use this page to grasp IFS fundamentals before diving into the feature-rich `fractals.html` upgrade.


## Sinus & Cosinus Oscillator Game (oscigame.html)

## Experience
`oscigame.html` visualizes Lissajous figures in 3D. Using Three.js, it traces the motion of two perpendicular oscillators and lets you manipulate frequency, amplitude, and phase with mouse gestures or keyboard shortcuts.

## Mechanics
1. **Parametric motion** – A trail of vertices is updated each frame based on `sin(2πf₁t + φ₁)` and `cos(2πf₂t + φ₂)` with adjustable amplitudes. The path is drawn with a translucent `THREE.Line` whose alpha fades along the tail.
2. **Interaction scheme** – Right-click drag changes parameters: horizontal drags adjust cosine values, vertical drags sine values. Modifiers `Alt` and `Ctrl` toggle between amplitude and phase adjustments; no modifier means frequency.
3. **Camera control** – WASD + QE keys move the camera freely (“shooter” controls). Press `F` to reset to the default orbit and restore oscillator defaults.
4. **Center of mass** – The script computes the mean position of recent points to keep the visualization centered and to aim the camera when resetting.

## Playful challenges
- Create knots by setting `frequencySin : frequencyCos` to small integer ratios like 3:4.
- Hold `Alt` and drag to exaggerate amplitudes, turning the pattern into a stretched ribbon.
- Spin phases with `Ctrl` drags to morph from sine/cosine alignment into swirling helices.

## Developer insights
- Geometry buffers (`trailGeometry`) are reused; positions and per-vertex alpha values are updated in place for performance.
- Animation uses `requestAnimationFrame` and `Date.now()` to compute elapsed time since reset.
- Lighting (ambient + point light attached to the camera) keeps the trail glowing regardless of camera orientation.

This game lets learners feel how sine and cosine combine—by literally grabbing frequencies and phases and watching the math draw neon sculptures in the air.


## Advanced 3D Oscillator Suite (oscillator.html)

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


## Deterministic 2D Physics Editor (physics.html)

## Purpose
`physics.html` is a sandbox where you can design rigid-body scenes and run deterministic simulations. It combines an editor (add bodies, joints, forces) with a custom physics integrator—no external engine required.

## Building blocks
1. **Body definitions** – Objects are circles or polygons stored in the `bodies` array with properties like mass, restitution, and color. The sidebar form populates these fields and pushes new bodies when you click “+ Add Object”.
2. **Forces & constraints** – Gravity, drag, and user-defined impulses are applied each frame. Joints link body pairs with configurable stiffness/damping, stored in the `joints` array.
3. **Deterministic stepper** – A fixed timestep integrator updates positions and velocities using semi-implicit Euler. Because the timestep is constant, replaying the same sequence yields identical results.
4. **Collision handling** – Broad-phase AABB checks precede narrow-phase collision resolution. Restitution and friction coefficients from the body data influence the response.
5. **Undo/redo** – Editor actions push snapshots onto stacks so you can rewind design changes. Buttons in the corner are disabled when no history exists.

## UI highlights
- **Right sidebar**: collapsible `<details>` sections for world settings, objects, joints, and advanced tweaks (drag coefficients, contact solver iterations).
- **Canvas**: double-click to select bodies, drag to reposition, and use hotkeys for quick duplication or deletion.
- **Overlay widgets**: FPS counter, pause/play, and toggles to show collision normals or bounding boxes.

## Experiments
- Build a Newton’s cradle by adding aligned circles, connecting them with joints, and tuning restitution.
- Increase solver iterations to see how stacking stability improves.
- Switch gravity to zero and enable drag to simulate space robotics manipulations.

## Developer notes
- All state is plain JavaScript objects—perfect for exporting JSON or creating sharing links.
- Rendering uses Canvas 2D; physics and drawing are decoupled so you can swap in WebGL if desired.
- Determinism hinges on using `performance.now()` only for diagnostics; physics updates rely on accumulated fixed timesteps.

With this file, you can teach mechanics from first principles: define forces, see outcomes, iterate.


## Minimal Deterministic Physics Sandbox (physicssimple.html)

## Intent
`physicssimple.html` distills the full physics editor into an approachable demo. You spawn circles, fling them with deterministic velocities, toggle gravity, and watch them collide—all without fiddling with complex forms.

## Key mechanics
1. **Circle spawning** – Right-click drops a circle with a seeded pseudo-random velocity so repeated experiments are reproducible. Hold `Alt` while dragging to choose the velocity vector manually.
2. **Dragging** – Left-click drag on an existing circle sets its new velocity based on drag distance, making momentum conservation intuitive.
3. **Deterministic updates** – Like the full editor, the integrator runs on a fixed timestep. Resetting the simulation yields identical motion sequences if you repeat the same inputs.
4. **Collision resolution** – Circles collide elastically with boundary walls and each other using simple impulse math tuned for clarity over realism.

## UI cues
- Instructions overlay enumerates every shortcut.
- Control panel toggles gravity, friction, restitution, and the deterministic seed.
- FPS counter ensures the browser keeps up with the calculations.

## Experiments
- Set gravity off, spawn a triangle of circles with equal velocities, and observe the conservation of momentum.
- Toggle gravity on mid-simulation to see how trajectories curve realistically.
- Adjust restitution to compare bouncy vs damped collisions.

## Developer notes
- Code is cleanly separated into physics update, rendering, and input handlers—ideal for teaching how games structure loops.
- Deterministic randomness uses a seeded PRNG; tweak the seed slider to generate different but repeatable launch patterns.
- For extension, add polygon bodies by mimicking the circle data structure.

This file is perfect for first encounters with physics simulation: hands-on, repeatable, and friendly.


## Root README Explained

## Purpose
The top-level `README.md` is the front door to the repository. It introduces Kurzlernen as “Static website with interactive educational pages” and hints that the site is deployed with GitHub Pages. Simple, but mighty: this one sentence sets the expectation for newcomers who open the repo on GitHub.

## Why keep it short?
From first principles, a README needs to answer three questions quickly: What is this? Can I use it? Where is it hosted? The existing text answers all three in a single breath. The GitHub UI already surrounds the file with repo metadata (stars, issues, license), so a succinct description avoids redundancy and lets curious readers dive straight into the code or the new per-file READMEs in this `docs/` folder.

## When to update it
- **New flagship features** → Add a quick teaser so visitors know what’s new.
- **Deployment changes** → If the hosting platform or workflow changes, mention it here.
- **Onboarding links** → Link to documentation, issue templates, or the most popular interactive demos.

## Make it sparkle
Want a tiny challenge? Try rewriting the root README in exactly three sentences: one for the vision, one for the technology, one for how to explore. That micro exercise keeps the message crisp and forces us to focus on what matters most.

In short: the root `README.md` is a minimalist lobby. The detailed guided tours live in the neighboring rooms you’re reading right now.


## Datenkodierung mit Rauschen (reconstruct.html)

## Idea
This app demonstrates how a noisy signal can still be reconstructed if you know the underlying sinusoid. Sliders control amplitude, frequency, phase, noise strength, and sample count; a Chart.js plot shows both noisy measurements and the reconstructed curve.

## Process
1. **Signal generation** – Given `A`, `f`, and `φ`, the script computes `y = A sin(2π f t + φ)` for `N` samples. Uniform noise scaled by `dataNoiseRangeAmplitude` is added to mimic measurement errors.
2. **Encoding** – The “save parameters” button exports the current settings and noisy data to JSON, illustrating how you might transmit the signal description instead of every sample.
3. **Reconstruction** – Clicking “Kurve rekonstruieren” regenerates the clean sinusoid using the stored parameters and overlays it on the chart so learners can compare raw vs reconstructed data.
4. **Visualization** – Chart.js handles rendering. The zoom plugin allows panning/zooming for detailed inspection of error bands.

## UI map
- Sidebar cards provide tactile feedback for each slider value.
- Header buttons manage persistence: save parameters, load a JSON file, or rebuild the curve.
- Main panel contains the dual-line chart plus textual summaries (mean error, SNR) under the graph.

## Try it yourself
- Raise noise amplitude to 1.0 and observe how reconstruction still hugs the underlying sine because the model knows the phase.
- Reduce sample count to explore aliasing effects; challenge students to spot when the reconstruction diverges.
- Export parameters, reload the page, and use “Parameter laden” to showcase reproducibility.

## Developer notes
- Parameters are stored in a simple object—extend it with polynomial terms or harmonics to teach Fourier decomposition.
- Chart datasets are updated in place, so the animation remains smooth even with frequent slider changes.
- Because the theme uses DaisyUI via CDN, customizing colors is as easy as switching the `data-theme` attribute on `<html>`.

This tool connects abstract encoding theory with a tangible slider experiment: noisy data in, pristine reconstruction out.


## Interaktiver Stromkreis (stromkreis.html)

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


## texts.json Reference

## Purpose
`texts.json` stores narrative snippets used by the learning tasks in `index.html`. It supplies both the reading passage and the copywork paragraph so the page can load content without hardcoding it directly.

## Structure
```json
{
  "initialReadText": "<em>…</em>",
  "initialWriteText": "<strong>…</strong>"
}
```
- **initialReadText**: HTML-formatted story about discovering a mysterious diary. The text is rich with descriptive language, perfect for expressive reading practice.
- **initialWriteText**: Bold-labeled copywork assignment instructing learners to transcribe a key sentence from the story.

## How it’s used
- `index.html` reads these fields when initializing tasks, populating the reading card (`#readText`) and writing card (`#writeText`).
- Because the strings include HTML tags, they render with emphasis and line breaks right out of the box.

## Customization ideas
- Replace the passages with seasonal stories or subject-specific texts to keep practice fresh.
- Add new fields (e.g., `mathPrompts`, `vocabularyWords`) and extend the page’s initialization logic to pull them in.
- Localize by providing translations and switching which JSON file is fetched based on the user’s language.

## Editing tips
- Keep special characters escaped properly (JSON requires quotes and backslashes to be escaped).
- Because HTML is embedded, validate the markup to avoid broken formatting.

This file may be small, but it’s the storytelling fuel that powers the daily learning routine.


## Advanced Vector Drawing Application (vectors.html)

## Purpose
`vectors.html` is a CAD-lite editor built on HTML Canvas. It lets you draw points, connect them into segments, detect faces, and even export the resulting geometry as an ASCII STL file for 3D printing or further modeling.

## Capabilities
1. **Sketching** – Left-click to place points, drag to create segments, and snap to existing vertices or guideline intersections. A selection rectangle (`#selectionRect`) supports multi-select for moving groups.
2. **Precision tools** – The alignment overlay shows angles and lengths in real time. Holding modifier keys enables axis locking or midpoint snapping, making orthogonal or symmetrical designs easy.
3. **Face detection** – When closed loops are formed, the app identifies polygonal faces, fills them, and lists them for extrusion/export.
4. **Project persistence** – Buttons save/load JSON snapshots of all points and segments, so you can resume editing later.
5. **STL export** – `exportSTL()` triangulates detected faces and bundles them into an ASCII STL string that downloads instantly—perfect for quickly prototyping laser-cut or printed parts.
6. **Help system** – A built-in modal enumerates every shortcut and gesture so users can onboard themselves.

## Try these activities
- Sketch a simple house (rectangle + triangle roof) and export to STL to see how 2D faces become 3D shells.
- Use the alignment status readout to create vectors at exact 45° increments.
- Practice selecting multiple points with the marquee, then press Delete to remove them as a group.

## Developer notes
- Geometry is stored in arrays of point and edge objects; computations like face detection iterate over these structures. The deterministic order keeps exports consistent.
- Canvas rendering is layered: grid background, segments, points, selection overlay, and UI elements are drawn sequentially each frame.
- Export uses a simple fan triangulation; for concave polygons consider switching to ear clipping.

This application bridges art and engineering: draw freely, but with enough precision to manufacture what you sketch.


## Story Hub Landing Page (yourstories.de)

## Essence
`yourstories.de` is a one-page marketing site for a storytelling service. It shares DNA with `geschichte.html` but is tailored as an external landing page with bold hero sections, feature highlights, pricing, testimonials, and a closing call-to-action.

## Anatomy
1. **Navbar** – Minimal top bar with “Preise” and “Jetzt starten” buttons that scroll to sections using anchor links.
2. **Hero** – Full-screen background pattern, giant headline, and dual call-to-action buttons. Content centers around Christian Hohlfeld’s storytelling craft and AI voice synthesis.
3. **Feature grid** – Cards introduce benefits like premium AI voices, personal Betreuung, and flexible Abos.
4. **Pricing section** – Three packages (Einzelkauf, Monatsabo, Autoren-Paket) with checkmarks and animated hover scale.
5. **Testimonials** – Carousel-like list of satisfied clients with avatars and quotes.
6. **CTA section** – Encourages immediate sign-up with another button set and supportive copy.
7. **Footer** – Contact details and legal links for a professional finish.

## Experience principles
- Tailwind + DaisyUI deliver responsive design without manual CSS heavy lifting.
- Typography uses the Inter font family to keep everything crisp and modern.
- Utility classes power subtle animations (hover scaling, box shadows) to guide the eye.

## Ideas for customization
- Hook the CTA buttons to your CRM or scheduling app by changing the `href` attributes.
- Add analytics by inserting a `<script>` tag near the end; the layout already includes clear conversion points.
- Translate the text to other languages or adjust the theme colors by modifying the `data-theme` attribute on `<html>`.

This page is a polished storytelling sales pitch: it frames the problem, showcases the solution, and invites the reader to act.
