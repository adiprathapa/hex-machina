# Hex Machina

**Magic is just code with worse documentation.**

Hex Machina is a graph-native WebMCP game about debugging executable spells with an agent. The human decides what must survive; the agent traces the spell, searches constraint-aware repairs, and applies a reviewable patch to the same graph both participants can see.

The canonical lesson asks the player to water a Moonflower. The initial spell floods the observatory with twelve lunar ducks. The player protects the ducks as a sacred constraint, forcing a stranger but valid repair: give them umbrellas and redirect their rain onto the flower.

## Run locally

Requirements: Node.js 22.13 or newer and Python 3.11 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Verification

```bash
python3 prepare.py --quick
```

This runs static product-contract checks, TypeScript validation, unit and integration tests, the production build, and linting. Full browser acceptance is tracked separately until its automated suite is added.

## Architecture

- `src/domain/` — typed graph schema, validation, stable serialization, atomic patches
- `src/scenarios/` — deterministic Moonflower fixture
- `src/simulator/` — cast execution and ordered event traces
- `src/solver/` — causal diagnosis and constraint-aware repair search
- `src/tools/` — shared semantic handlers and guarded WebMCP registration
- `app/` — the visual spell canvas and local fallback console
- `tests/` — graph, simulation, repair, and WebMCP contract coverage

The browser application remains the source of truth. WebMCP handlers call the same domain functions used by the local interface; the agent never owns graph state or invariant enforcement.

## Site tools

- `inspect_spell`
- `trace_effect`
- `simulate_cast`
- `explain_side_effect`
- `set_sacred_constraint`
- `propose_spell_patch`
- `apply_spell_patch`

The tool adapter registers only when `document.modelContext.registerTool` is available. Ordinary browsers retain the complete playable fallback.

## Durable build loop

The seven-day build specification is in `program.md`. Use `python3 train.py status` for milestone state and `python3 train.py context` for a complete continuation handoff.
