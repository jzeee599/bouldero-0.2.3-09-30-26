# Milestone 1 verification

## Automated checks

- `pnpm typecheck`: passed.
- `pnpm build`: passed with Next.js 16.3.5 in Webpack mode, including static generation of `/` and `/manifest.webmanifest`.
- Playwright Chromium: **4 tests passed**.
  - 15 holds saved, page reloaded, project reopened, and marker alignment checked at phone, desktop, landscape, and 320px widths.
  - Dragging, keyboard movement, bounds clamping, delete/reorder, undo, and TOP behavior.
  - Required-field validation and recovery from a simulated storage failure.
  - Invalid-image error handling.

The Vercel build uses Node.js 22 through `package.json`. The development machine currently provides Node.js 24, so local pnpm prints an engine warning; compilation and tests still pass. Vercel will not show that mismatch.

## Remaining acceptance checks

- Upload a real photo taken by the target iPhone; confirm its orientation and manually check hold alignment after closing/reopening.
- Configure a Supabase project, apply the migration, and perform a cloud save/reopen round trip.
- Use a second anonymous identity to confirm database and Storage owner isolation against the deployed policies.
- Test route photos with closely spaced holds and touches with an actual finger.

These checks cannot be replaced by synthetic browser fixtures.

## Milestone 2A verification — 2026-09-23

- `pnpm typecheck`: passed.
- `pnpm build`: passed with Next.js 16.3.5 in Webpack mode.
- Playwright Chromium: **5 tests passed**, including all four V1 regression tests.
- The new end-to-end test creates a gym-tagged line, starts a session, records a Sent attempt with notes, reloads, and verifies the attempt remains visible.
- IndexedDB upgrades from version 1 to 2 without replacing the existing `projects` store.
- The cloud path adds owner-only session and attempt tables through `002_sessions_attempts.sql`.

## Milestone 2B verification — 2026-09-23

- TypeScript check passed.
- Six Playwright tests passed, including all V1 and 2A regressions.
- The 2B test creates a second line from an existing photo, saves it in count-only mode with zero holds, verifies IndexedDB stores no duplicate Blob, and records two attempts as its count.
- The cloud migration adds mode constraints and an owner-checked photo-reuse RPC.

## Milestone 2C verification — 2026-09-23

- TypeScript check passed.
- Seven Playwright tests passed, including all V1, 2A, and 2B regressions.
- The 2C test marks a line completed, finds it through the Completed filter, changes to list view, filters by gym, searches, archives the line, and restores it to Ongoing.
- Status changes update IndexedDB locally or the owner-protected `projects` row in Supabase.

## Milestone 2D verification — 2026-09-23

- TypeScript check passed.
- Eight Playwright tests passed, including all previous milestone regressions.
- The 2D test creates a line, starts a gym session, records a Sent attempt with notes, ends the session, verifies timeline counts and notes, then opens the line and verifies cross-session progress.
- History is derived from existing owner-scoped sessions, attempts, and lines, so no database migration is required for 2D.

## Version 0.2.2A verification — 2026-09-26

- TypeScript check passed.
- Production build passed with Next.js 16.3.5 in Webpack mode and static generation of `/` and `/manifest.webmanifest`.
- Ten Playwright Chromium tests passed, including all eight 0.2.1 regressions.
- The photo/notes test replaces a selected image, confirms old hold markers are cleared, saves line-level notes, reloads, and verifies the notes persist.
- The backup test exports IndexedDB records and their photo blobs, deletes the local database, imports the downloaded JSON file, and verifies the line, photo, and notes are restored.
- Supabase-backed line notes require `005_project_notes.sql`. Local export/import intentionally remains a device-storage feature for this milestone.

## Version 0.2.2B verification — 2026-09-26

- TypeScript check and the Vercel-equivalent production build passed.
- Eleven Playwright Chromium tests passed, including all 0.2.2A regressions.
- The new browser test records a failed start, switches to a partial start, rejects an ending hold before the selected start, then saves three attempts together and verifies their start and controlled-hold labels.
- Batch insertion is atomic in IndexedDB and uses one Supabase insert request. Sends remain single entries so one completion cannot be multiplied accidentally.
- Cloud-backed partial-start tracking requires `006_attempt_start_progress.sql`; existing local attempts load with a ground-start default.

## Version 0.2.2C verification — 2026-09-26

- TypeScript check and the Vercel-equivalent production build passed.
- Twelve Playwright Chromium tests passed, including all 0.2.2B regressions.
- The new session-flow test starts with two carried-in lines, verifies the live counters, switches between lines without returning Home, records an attempt, creates a new line during the session, and verifies each count updates.
- The same test records a send and verifies the completed confirmation and one-tap next-line action.
- Session counters and switching are derived from existing projects, sessions, and attempts, so this milestone requires no database migration.

## Version 0.2.2D / 0.2.2 final verification — 2026-09-28

- TypeScript check and the Vercel-equivalent production build passed with Next.js 16.3.5 in Webpack mode.
- Thirteen Playwright Chromium tests passed, including all twelve 0.2.2C regressions.
- The new browser test creates a reusable Warm-up line, reopens the saved hold editor, adds another hold, records a send, and verifies that the line remains Ongoing and the warm-up send stays out of performance send totals.
- Existing local records and version-1 backup files default to the `Project` purpose; no IndexedDB reset is required.
- Cloud mode requires `007_route_purpose_and_editing.sql`, which adds the purpose field plus owner-checked create and edit RPCs.

## Version 0.2.3F verification — 2026-09-30

- TypeScript check and the Vercel-equivalent production build passed with Next.js 16.3.5 in Webpack mode.
- Seventeen Playwright Chromium tests passed, including all earlier release regressions.
- Warm-up sends are consistently excluded from performance totals, and legacy completed Warm-ups are persisted back as reusable ongoing lines.
- Correcting an attempt result synchronizes the current line status; edited attempt times and hold order are validated.
- Past-session edits cannot move the session boundary past an attempt already stored inside it.
- An active session can still open and edit lines from another gym, but it cannot log their attempts into the wrong gym’s session.
- Cloud migration `008_preserve_attempt_hold_links.sql` updates retained holds in place so editing a line does not erase historical attempt-to-hold links.
