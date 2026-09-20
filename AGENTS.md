# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite-built Chrome Manifest V3 extension written in React and TypeScript.

- `src/popup/`, `src/sidepanel/`, `src/result/`, and `src/settings/` contain the four UI entry points.
- `src/content/` extracts page content; `src/background/` handles extension messages and storage.
- `src/services/`, `src/lib/`, and `src/utils/` hold translation, extraction, navigation, and output logic.
- `src/types/` contains shared contracts. Tests live beside their modules as `*.test.ts`, with shared mocks in `src/test/`.
- `public/manifest.json` is copied into the production build. `dist/` is generated output; edit source files instead.
- Product requirements and layouts are documented under `docs/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the Vite development server.
- `npm test`: run the Vitest suite once using the jsdom environment.
- `npm run typecheck`: validate application and Vite configuration types.
- `npm run build`: create the loadable extension in `dist/`.
- `npm run check`: run type checks, tests, and a production build; use this before submitting changes.

To test manually, build the project, open `chrome://extensions`, enable Developer mode, and load `dist/` as an unpacked extension.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, and no semicolons, matching the existing TypeScript. Name React components and their files in PascalCase (`App.tsx`), functions and variables in camelCase, and constants in UPPER_SNAKE_CASE. Keep Chrome message types and stored-data interfaces explicit. Prefer small helpers in the existing `services`, `lib`, or `utils` folders over duplicating browser logic. No formatter or linter is configured, so follow nearby code closely.

## Testing Guidelines

Vitest, jsdom, and Chrome API mocks provide the test environment. Name tests `*.test.ts` and keep them near the code under test. Add focused coverage for message contracts, storage behavior, navigation fallbacks, parsing, and error states. Run `npm run check` after behavior or build-configuration changes.

## Commit & Pull Request Guidelines

History currently uses brief Chinese subjects without required prefixes (for example, `优化样式`). Keep commits small and use a clear imperative subject describing one change. Pull requests should explain the user-visible result, list verification commands, link any relevant issue or `docs/task.md` item, and include screenshots for Popup, Side Panel, Result, or Settings UI changes.

## Security & Configuration

Never commit API keys or personal article data. Keep credentials in `chrome.storage.local`. Review additions to `permissions`, `host_permissions`, and external endpoints carefully, and document why broader access is necessary.

## Task Execution Protocol

- Treat `docs/task.md` as the authoritative sequence. Work on exactly one numbered task at a time; do not implement later tasks opportunistically.
- Before implementation, mark only the current task `[~]`. Mark it `[x]` only after type checking, relevant tests, a production build, and documentation synchronization succeed.
- Read the task card plus the relevant sections of `docs/proposal.md`, `docs/design.md`, and `docs/layouts/` before editing. Update affected docs and `README.md` with the implementation.
- Prefer existing modules and delete only code made obsolete by the current task. Keep pure logic independent of React, Chrome APIs, and storage; connect modules through explicit types rather than shared mutable state.
- Never edit `dist/`; it is generated. Inspect it only when diagnosing production output, and make fixes in source files.
- Preserve all unrelated local changes. This repository currently has a substantial uncommitted worktree containing the completed Demo implementation; do not reset, revert, rename, or clean those files unless the user explicitly requests it.

## Current Handoff State

- Work is paused as of 2026-09-20 with Task 25 still `[~]`; do not mark it complete until the real-model five-site checklist passes.
- Demo tasks 00–16 and second-stage tasks 17–24 are complete. Task 25 has started but is blocked by model compliance, not by extraction, permissions, or the structure validator.
- Production extraction passed on MDN, React, web.dev, Node.js, and GitHub Docs. Local Ollama `qwen2.5` 0.5B–7B models did not reliably preserve Markdown protection markers; one 3B success could not be repeated.
- The second-stage roadmap is: 17–19 long-article reliability, 20 Markdown integrity, 21–22 endpoint/permission safety, 23 storage durability, and 24–25 Chrome E2E/final acceptance.
- Stability and privacy UI through task 23 is documented in `docs/layouts/05-稳定性与隐私交互.md`; no additional product UI is planned for task 24.
- The latest Task 25 regression passed `npm run check` and `npm run test:e2e`: 22 Vitest files / 127 tests plus one production-extension Chrome E2E. The build retains a non-blocking warning for an application chunk over 500 kB.
- Task 25 evidence and remaining manual items are in `docs/acceptance.md`. Resume with a capable personal OpenAI-compatible model; never record an API key, page snapshot, or downloaded article in the repository.
- Task 23 introduced storage version 1: `translationResults` owns full records, `lastResult` stores an ID, and `translationHistory` stores lightweight metadata. Legacy data migrates on read without clearing user content.

## Second-Stage Architecture Boundaries

- Preflight, Markdown splitting, and structure protection should be separate pure functions with focused tests.
- A serial translation executor owns ordering, cancellation, progress, and resume; UI components only render its state.
- Markdown protection wraps a single model request and must not depend on queue state.
- Chrome permission requests belong in a browser adapter, not the extractor or translation client.
- Storage migration and quota handling remain in the storage service. E2E fixtures and the fake OpenAI-compatible server remain outside production modules.
- The keyless Chrome E2E harness stays under `e2e/`; remaining validation work is task 25's personal-model, multi-site acceptance.
