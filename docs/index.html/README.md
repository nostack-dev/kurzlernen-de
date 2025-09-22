# Kurzlernen Mission Control (index.html)

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
