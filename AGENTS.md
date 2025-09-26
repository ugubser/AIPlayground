# Repository Guidelines

## Project Structure & Module Organization
- Angular UI lives in `src/app` with standalone components and services; assets stay in `src/assets` and environment templates in `src/environments`.
- Shared config such as `shared/config/models.config.json` feeds both the client and Cloud Functions through build scripts.
- Firebase Cloud Functions code lives in `functions/src`; build output is emitted to `functions/lib`.
- Documentation and UX assets are tracked in `docs/`; production bundles are generated in `dist/`.

## Build, Test, and Development Commands
- First-time setup: `npm install` then `cd functions && npm install`.
- `npm run emulators` seeds env files via `scripts/build-env.js` and launches the Firebase emulator suite.
- `npm run start` serves the Angular app on `localhost:4200`; `npm run build` or `build:prod` create development or production bundles.
- `npm run test` runs Karma/Jasmine unit tests; use `ng test --watch` for iterative work.
- `npm run build:functions` prepares Cloud Functions, and `npm run deploy` ships both client and functions once secrets are configured.

## Coding Style & Naming Conventions
- TypeScript with 2-space indentation, trailing commas, and Angular CLI defaults; format templates with concise structural directives.
- Components, services, and models are `PascalCase`; variables and observables use `camelCase`, with a `$` suffix reserved for stream references.
- Source files should read configuration from generated environment files instead of hard-coded endpoints or credentials.

## Testing Guidelines
- Place specs beside source files using the `*.spec.ts` suffix; mirror component or service names inside `describe` blocks.
- Exercise Firebase logic against the emulator suite before pushing and note any gaps in TODOs or PR descriptions.
- For Cloud Functions, add lightweight integration scripts under `functions/src/__tests__` (or similar) and run them after `npm run build:functions`.

## Commit & Pull Request Guidelines
- Match the existing log: imperative, capitalized commit subjects (e.g., "Fix multi-task executor task result mapping").
- Keep commits focused; describe behavioural changes and relevant context in the body when the diff is non-trivial.
- Pull requests should link issues, summarize UI or API impacts, attach screenshots when visuals change, and confirm local `npm run build` and `npm run test` passes.

## Environment & Security Notes
- Copy `.env.template` to `.env` and `functions/.env.template` to `functions/.env`; never commit populated variants.
- Maintain parity between local secrets and Firebase-hosted secrets via `firebase functions:secrets:set`, and review `firestore.rules` / `storage.rules` when schemas evolve.
