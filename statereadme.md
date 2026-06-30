# State Blueprint Manifest

State Blueprint is a visual finite-state-machine builder driven by one global JSON event bus.
The canvas is not decoration around code. It is the model editor for the machine.

## Core Principle

There is exactly one live application state: `globalState`.

The JSON model declares states, transitions, render order, bus defaults, subscriptions, and component bindings. Runtime keeps one mutable object, `globalState`, and applies those declarations as writes to that object. Nothing flow-relevant may live only in DOM state, cached component state, preset HTML, or hidden widget stores.

## FSM Contract

- A state represents a constellation of global data that can render UI, subscribe to bus paths, and expose outgoing transitions.
- Transitions are driven by explicit events, timers, or bus changes.
- Transition conditions read `globalState`.
- Transition `set` patches write back into `globalState`.
- The active state is also bus data: `state.current`, `state.previous`, and `state.lastTransition`.
- Parent/child flows use boundary proxies as references, not copied states.

## Data Contract

- `state.data` is a model declaration for missing-key defaults and bus shape. It is not a second runtime store.
- Defaults are applied only when the target bus key is still undefined.
- Removing a Canvas State removes its declared state-scoped contribution from runtime context on the next sync.
- Presets are catalog entries. They do not add live data until dropped onto the canvas.
- Dropped Daisy presets expand `$state` into a collision-free path: `states.<stateId>`.
- Interactive values live in `globalState`. Components never keep a private copy of their bound data.

## Render Contract

- Render is view-only over the JSON model and `globalState`.
- Render must never start fetches, mutate flow state, or create model data.
- Render order is model data and must stay editable.
- Transition buttons are render items because the app preview renders them.
- Data wires are render items when they affect visible output.
- Components may read and write only explicit bus paths.
- No component may hide flow decisions in local DOM state.

## DaisyUI Contract

DaisyUI is a renderer and interaction skin, not the truth.

- Daisy presets store structured JSON, not HTML blobs.
- Daisy components bind to explicit `dataPath` values.
- Inputs write bus fields such as `value`, `checked`, `selected`, or `open`.
- Buttons either fire outgoing transition events or write explicit bus fields.
- Dropdowns, modals, drawers, tabs, toggles, and similar widgets keep their meaningful state in `globalState`.
- Cosmetic hover/focus behavior may stay local; anything that affects data or flow must be on the bus.

## Editor Contract

- The editor edits the JSON model.
- The preview runs the same model through the runtime bus.
- Fetch is a state-entry effect and writes structured results into configured bus targets.
- Repeat paths and render mappings are explicit user choices, not guessed/persisted by automap.
- State explorer presets are reusable model templates, not caches.

## Test Contract

Tests should protect behavior, not old DOM accidents.

- Prefer stable model, bus, SVG-port, and runtime contracts.
- Do not weaken tests to fit regressions.
- If a test depends on old markup, update it to the current public contract.
- Canvas connector and boundary-proxy behavior is core and must be protected directly.

## Roadmap

- Visual DataWire tool: node-style data mapping from bus paths into render components.
- Bus/schema inspector: simple path picker for user-relevant state constellations.
- Subscription builder: "key-lock" UI for selecting which data constellation wakes a state or transition.
- AI control surface: API-first commands for reading the model, applying patches, validating contracts, and generating presets without touching hidden state.
- Component authoring: Daisy/custom components as structured JSON bindings with explicit bus IO.
- Validation layer: model checks for orphaned bindings, stale state data, broken transitions, and non-bus interactions.
