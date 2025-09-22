# Cardio Log (cardio.html)

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
