# Story Hub Landing & Generator (geschichte.html)

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
