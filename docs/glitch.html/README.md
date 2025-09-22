# Rubbellos-Leiter Pro (glitch.html)

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
