# Hex Machina

**Magic is just code with worse documentation.**

> A graph-native WebMCP game where a human and a browser agent negotiate executable intent.

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
npm run test:e2e
```

The quick acceptance command runs product-contract checks, strict TypeScript validation, unit and integration tests, a production build, and linting. The E2E command exercises the built worker and its accessible production shell. GitHub Actions runs both on pushes and pull requests.

For release verification, run:

```bash
python3 prepare.py
```

The full command also checks production E2E behavior and recorded browser evidence. Live `document.modelContext` discovery requires a compatible WebMCP browser, so an ordinary browser can pass every local gate while that final deployment gate remains pending.

## The 60-second story

1. Cast the faulty graph: twelve lunar ducks flood the observatory.
2. Trace the responsible path from `Multiply` through `Pour` to `The room`.
3. Mark the ducks sacred—the repair is now constrained by human taste.
4. Preview and apply the smallest valid structural patch.
5. Recast: umbrella-equipped ducks water the Moonflower while the room stays dry.

Every visible action is also available through a narrow semantic tool. In unsupported browsers, expand the local tool console to invoke those same handlers and inspect their structured JSON results.

## Architecture

- `src/domain/` — typed graph schema, validation, stable serialization, atomic patches
- `src/scenarios/` — deterministic Moonflower fixture
- `src/simulator/` — cast execution and ordered event traces
- `src/solver/` — causal diagnosis and constraint-aware repair search
- `src/tools/` — shared semantic handlers and guarded WebMCP registration
- `src/familiar/` — optional deterministic message-passing suspect ranking
- `app/` — the visual spell canvas and local fallback console
- `tests/` — graph, simulation, repair, and WebMCP contract coverage

The browser application remains the source of truth. WebMCP handlers call the same domain functions used by the local interface; the agent never owns graph state or invariant enforcement.

The canvas is semantically editable as well as draggable. Select a rune, choose **Link from rune**, then select one of the glowing compatible targets. The editor exposes the valid edge category, rejects invalid or duplicate connections, activates linked workshop runes, and advances the graph version atomically. Reset restores the canonical judge scenario.

## Site tools

- `inspect_spell`
- `trace_effect`
- `simulate_cast`
- `explain_side_effect`
- `set_sacred_constraint`
- `propose_spell_patch`
- `apply_spell_patch`

The tool adapter registers only when `document.modelContext.registerTool` is available. Ordinary browsers retain the complete playable fallback.

## Experimental Familiar

After a failed cast, Moth runs two rounds of frozen-weight message passing over active runes and ranks three likely inspection targets. It is an advisory visualization—not a source of causal truth—and never mutates the graph. Disable it at build time with `NEXT_PUBLIC_FAMILIAR_GNN=off`.

## Durable build loop

The seven-day build specification is in `program.md`. Use `python3 train.py status` for milestone state and `python3 train.py context` for a complete continuation handoff.

## Put this repository on GitHub

The project is already initialized on the `main` branch with a clean, reviewable commit history. After creating an empty GitHub repository—do not add a README or `.gitignore` there—connect and push it:

```bash
git remote add origin git@github.com:YOUR-ACCOUNT/hex-machina.git
git push -u origin main
```

Use an HTTPS remote instead if that matches your GitHub authentication setup. No remote is configured by default, and no source is published without the owner’s explicit action.

## Contributing and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository contract and verification workflow. A license is intentionally not selected yet; choose one before making the repository public.
