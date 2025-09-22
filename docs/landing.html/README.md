# ops.impact Landing Page (landing.html)

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
