# Contributing to Hexmend

Hexmend is deliberately small: one polished graph-debugging lesson, one deterministic simulator, and one semantic tool surface shared by people and browser agents. Changes should strengthen that loop before expanding its scope.

## Local setup

Requirements:

- Node.js 22.13 or newer (`nvm use` reads the included `.nvmrc`)
- Python 3.11 or newer

```bash
npm ci
npm run dev
```

## Before opening a pull request

Run the same checks used by CI:

```bash
python3 prepare.py --quick
npm run test:e2e
```

Run `python3 prepare.py` when changing browser acceptance evidence or preparing a release. Live `document.modelContext` discovery can only pass in a compatible WebMCP browser.

## Design constraints

- Keep the `SpellGraph` and deterministic simulator as the source of truth.
- Route UI actions and WebMCP registration through the same handlers in `src/tools/handlers.ts`.
- Treat agent proposals as untrusted input; validate versions, identifiers, and graph invariants before mutation.
- Preserve deterministic serialization and simulation.
- Add tests with production changes.
- Keep the canonical Moonflower-and-ducks journey fast, understandable, keyboard-accessible, and replayable.
- Do not add an in-app LLM dependency. The visiting browser agent supplies intelligence.

## Commit style

Prefer small, coherent commits with imperative summaries, such as `Harden patch validation` or `Polish the failure trace`. Never commit credentials, generated build directories, environment files, or private deployment archives.

