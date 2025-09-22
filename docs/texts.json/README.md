# texts.json Reference

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
