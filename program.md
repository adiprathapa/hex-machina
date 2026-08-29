# Hex Machina — Seven-Day Build Program

## Mission

Build, verify, polish, and prepare a submission-ready version of **Hex Machina**, a graph-native WebMCP game in which a person and an agent collaboratively debug executable spells.

The product thesis is:

> Graph interfaces let humans and agents negotiate executable intent.

The game is also a legible agent-evaluation environment. Its typed graph is the observation, the seven semantic tools are the action space, application-owned handlers define deterministic transitions, and the human-constraint-preserving journey supplies a reproducible reward signal. The canonical lesson remains the judge-facing demonstration; an Agent Gym protocol exposes reset, step, score, and an exportable trajectory for evaluating tool-using policies. Two deterministic causal families now provide 72 opaque-ID and prompt variants across disjoint train, validation, and test splits: Moonflower tests an unshielded amplified carrier path, while Resonant Aviary tests a reachable directed feedback cycle. This is evidence that a grounded policy transfers across two simulator rules, not a claim that the application already trains models or generalizes broadly.

The player creates spells from typed rune nodes and directed edges. Casting executes the graph. Incorrect or unstable graphs create funny, visible side effects. The browser agent uses semantic WebMCP tools to inspect the same live spell, explain causal paths, preserve the player's subjective constraints, propose minimal repairs, and apply approved patches.

The canonical demo begins with a request to water a moonflower. A faulty multiply-before-target spell summons levitating ducks and floods the room. The player insists that the ducks remain. The agent must repair the spell without deleting the duck branch; the successful cast gives the ducks umbrellas and redirects their rain onto the flower.

## Operating window

- Start: 2026-08-26, America/New_York.
- Continuous build window: seven days, ending 2026-09-02.
- Work cadence: one autonomous continuation every four hours.
- At every continuation, make the highest-value safe improvement that can be completed and verified in the available turn.
- Do not merely report status while actionable work remains.
- Stop changing the product once all acceptance gates pass. At that point, concentrate on regression checks, submission materials, and concise handoff notes.

## Definition of done

Hex Machina is done only when all of the following are true:

1. A new visitor can understand the objective without reading documentation.
2. The moonflower scenario can be completed from initial failure through a constraint-preserving successful recast.
3. The spell is represented as a typed directed graph, not a cosmetic node canvas.
4. Casting is deterministic for a given graph and scenario seed.
5. At least these seven WebMCP tools are registered with narrow JSON schemas:
   - `inspect_spell`
   - `trace_effect`
   - `simulate_cast`
   - `explain_side_effect`
   - `set_sacred_constraint`
   - `propose_spell_patch`
   - `apply_spell_patch`
6. Read-only and mutating tools are accurately annotated.
7. Tool results return enough structured evidence to verify what happened.
8. Agent activity is visible in the interface: selected nodes, traced paths, pending patches, applied mutations, and cast outcomes.
9. Human constraints materially affect the solution. Preserving the ducks must produce a different valid repair than removing them.
10. The experience works without an OpenAI API key. The visiting browser agent supplies the intelligence; the site supplies state, simulation, and semantic operations.
11. Keyboard navigation, focus visibility, reduced-motion behavior, color contrast, and mobile fallback are present.
12. Unit, integration, production-build, and browser smoke tests pass through `python3 prepare.py`.
13. The deployed experience has been tested in a WebMCP-capable in-app browser.
14. A submission package exists with a concise description, architecture summary, tool list, repository instructions, screenshots, and a 60–90 second demo script.
15. The same production handlers power a deterministic Agent Gym episode with reset/step semantics, explicit reward and termination flags, bounded rollouts, replayable public before/after observations, visible scoring, negative rewards for invalid or premature actions, exportable JSON/JSONL trajectories, streaming JSONL/Python adapters for online and vectorized training loops, and executable contrast policies proving reward separation. Private simulator roles and answer-key edges must never appear in agent observations. Patch IDs must be proposal-issued capabilities, never guessable write authorization.

## Product boundaries

### Must build

- One exceptionally polished scenario rather than a general-purpose spell platform.
- A graph editor with approximately 12–20 visible nodes in the main scenario.
- Typed ports or another clear mechanism that makes valid and invalid connections legible.
- A deterministic graph-rewrite/execution engine.
- Failure animation, causal trace visualization, constraint locking, patch preview, patch application, and successful recast.
- A reset/replay path suitable for repeated judging.
- WebMCP registration behind feature detection so ordinary browsers still work.
- A development fallback panel that can invoke the same tool handlers without WebMCP. This enables local testing and makes the product understandable outside supported browsers.

### Nice to have after the core passes

- Additional task families beyond the two implemented causal rules.
- A seeded spell generator.
- Export/import of a spell graph as JSON.
- Shareable replay URL.
- A small experimental "Familiar" GNN that predicts the rune most likely to cause an unintended side effect.

### Explicitly defer

- Accounts, multiplayer, payments, unrestricted user-authored scripts, external APIs, procedural 3D worlds, or a large campaign.
- LLM calls inside the application.
- A GNN as the authoritative simulator or explanation engine.
- Any feature that compromises the canonical demo, WebMCP reliability, accessibility, or deployment.

## Interaction contract

### Human responsibilities

- Compose or alter the spell.
- Decide which outcomes are desirable, funny, sacred, or unacceptable.
- Lock subjective constraints such as “the ducks must remain.”
- Approve or reject structural patches.

### Agent responsibilities

- Inspect exact graph state through semantic tools.
- Trace effects and isolate the responsible causal path.
- Simulate candidate outcomes.
- Search for a minimal valid patch under locked constraints.
- Explain proposed changes using node and edge identifiers.
- Apply a patch only through the designated mutation tool.

### Application responsibilities

- Remain the source of truth for graph state and simulation.
- Validate every tool input and graph mutation.
- Make side effects explicit.
- Return stable identifiers and before/after evidence.
- Never rely on the agent to enforce graph invariants.

## Graph domain model

### Node categories

- `source`: water, moonlight, fire, memory.
- `verb`: summon, transform, move, bind, release.
- `target`: flower, duck, room, moon.
- `modifier`: multiply, reverse, delay, soften.
- `condition`: when touched, unless observed, after bloom.
- `constraint`: preserve, avoid, limit.
- `sink`: intended terminal outcome.

### Edge categories

- `flows_to`
- `targets`
- `modifies`
- `triggers`
- `excepts`
- `requires`
- `cancels`

### Required invariants

- Every node and edge has a stable opaque ID.
- Edge endpoints exist and edge types are valid for their endpoint categories.
- The graph serialization is deterministic.
- Simulations never mutate editor state.
- Patches include preconditions and fail cleanly if applied to stale graph state.
- Sacred nodes and effects cannot be deleted or semantically negated by a proposed patch.
- Every cast returns an ordered event trace plus final outcome assertions.

## WebMCP tool contract

All handlers must be ordinary application functions first and WebMCP adapters second. The development tool panel and automated tests call the same handlers.

### `inspect_spell`

Read-only. Returns graph version, nodes, edges, sacred constraints, desired outcome, and current scenario state. Support optional bounded filtering by node IDs.

### `trace_effect`

Read-only. Given a source or outcome ID, return ordered causal paths, responsible edges, and any cycles or type violations. Bound maximum path count and depth.

### `simulate_cast`

Read-only with respect to editor state. Simulate either the current graph or a supplied patch preview. Return deterministic event trace, assertions, unintended effects, and success status.

### `explain_side_effect`

Read-only. Given a side-effect ID, return the smallest responsible subgraph and a plain structured explanation based on simulator rules.

### `set_sacred_constraint`

Mutating and reversible. Add, update, or remove a human-authored constraint tied to a node, edge, effect, or outcome. Return graph version and exact before/after constraint state.

### `propose_spell_patch`

Read-only. Search candidate graph mutations under current constraints. Return one to three ranked patches with operations, preconditions, predicted outcome, preserved constraints, and tradeoffs. It must not modify graph state.

### `apply_spell_patch`

Mutating and reversible. Validate patch preconditions and expected graph version, apply atomically, and return before/after graph summaries plus a verification simulation.

## Suggested technical architecture

Prefer a compact TypeScript web app:

- React + Vite or Next.js, choosing the smallest existing convention once scaffolding begins.
- TypeScript strict mode.
- Zustand, reducer state, or another simple local store.
- React Flow, Cytoscape.js, or a small custom SVG graph. Pick once; do not churn libraries.
- Zod or JSON Schema validation shared between UI actions and WebMCP handlers.
- Vitest for unit/integration tests.
- Playwright for browser smoke and interaction tests.
- Pure deterministic simulator module with no DOM dependencies.
- Static/local-first deployment whenever possible.

Recommended source boundaries:

```text
src/domain/       graph types, invariants, serialization
src/simulator/    deterministic cast and event trace
src/solver/       trace, diagnosis, constrained patch search
src/tools/        shared semantic handlers and WebMCP registration
src/scenarios/    moonflower fixture and optional puzzles
src/ui/           canvas, inspector, activity, animation
tests/            unit and integration suites
e2e/              browser tests
submission/       description, screenshots, video script
```

Do not create these directories merely to satisfy structure checks; create them as working modules emerge.

## Seven-day milestone sequence

### Day 1 — Skeleton and contracts

- Scaffold the application and establish scripts for dev, test, typecheck, build, and browser tests.
- Implement graph types, scenario schema, stable IDs, validation, and deterministic serialization.
- Build the moonflower fixture.
- Add initial unit tests.

Exit gate: graph fixture validates, serializes deterministically, and renders as nodes and edges.

### Day 2 — Execution engine

- Implement cast propagation and ordered event traces.
- Encode the canonical faulty spell and successful repaired state.
- Add explicit outcome assertions and side-effect IDs.
- Visualize propagation and failure.

Exit gate: the same seed always produces the same failure trace, and tests identify the multiply-before-target cause.

### Day 3 — Diagnosis and repair

- Implement causal tracing and minimal responsible-subgraph extraction.
- Add sacred-constraint state.
- Implement bounded patch search with stale-version protection.
- Confirm that “remove ducks” and “preserve ducks” yield distinct repairs.

Exit gate: unit and integration tests cover diagnosis, preview, application, rollback/reset, and constraint preservation.

### Day 4 — WebMCP

- Implement all seven tool handlers independently of the browser adapter.
- Register them through `document.modelContext.registerTool` when supported.
- Add accurate schemas, annotations, structured evidence, and visible tool activity.
- Build a local tool console that invokes the same handlers.

Exit gate: automated tests invoke every handler, invalid inputs fail safely, writes produce exact before/after results, and the app still works without WebMCP.

### Day 5 — Experience and accessibility

- Polish graph layout, rune identity, motion, cast spectacle, causal highlighting, patch diff, and onboarding.
- Add keyboard controls, focus behavior, reduced motion, responsive layout, and usable empty/error states.
- Make reset/replay fast and reliable.

Exit gate: a fresh tester can finish the canonical story without developer explanation.

### Day 6 — Hardening and optional GNN

- Eliminate flaky tests, console errors, hydration issues, schema drift, and nondeterminism.
- Run browser testing in supported and ordinary browsers.
- Only after all core gates pass, prototype the Familiar GNN behind a feature flag.
- Never delay core completion for ML.

Exit gate: `python3 prepare.py` passes the full acceptance suite from a clean install.

### Day 7 — Deployment and submission

- Deploy and verify production behavior.
- Test WebMCP discovery and the full judge prompt.
- Capture screenshots and record the concise demo.
- Finish README, architecture note, tool inventory, limitations, and submission copy.
- Run final regression and preserve a known-good release state.

Exit gate: live URL, repository, video, description, and all verification evidence are ready to submit.

## Canonical judge prompt

```text
Inspect my spell and cast it. Explain why it failed, but do not change anything yet. The ducks are funny, so preserve them as a sacred constraint. Find the smallest repair that waters the moonflower without flooding the room, show me the proposed patch, apply it, and cast the spell again.
```

## Acceptance strategy

`prepare.py` is the single top-level acceptance command. It performs static repository checks, discovers the package manager and scripts, checks required WebMCP tool names and safety markers, and runs available typecheck, unit, build, and browser suites. It should become stricter as the product matures, never looser to hide failures.

Every four-hour work cycle must:

1. Read this file and inspect the current repository rather than assuming prior state.
2. Run `python3 train.py status`.
3. Run `python3 prepare.py --quick` before modifying code to establish the current baseline.
4. Select one coherent unfinished milestone with the highest impact on the definition of done.
5. Implement it fully, including relevant tests and user-visible behavior.
6. Run focused tests, then `python3 prepare.py --quick` again.
7. Run the full `python3 prepare.py` when a milestone boundary is crossed or before deployment.
8. Record progress using `python3 train.py note "..."` and update milestone state when justified.
9. Leave the repository runnable; do not strand partial migrations or broken builds.

## Decision rules

- Prefer a complete vertical slice over multiple half-built systems.
- Favor deterministic, inspectable behavior over impressive but unreliable generation.
- Make the graph itself the shared artifact; avoid adding a chat panel to compensate for weak tool design.
- Preserve existing working behavior while iterating.
- Do not mark a milestone complete based solely on file existence.
- Do not weaken or skip tests to obtain green output.
- If blocked by unavailable credentials or external state, continue with local implementation, fixtures, tests, documentation, or deployment preparation.
- Ask the user only when a decision would materially change scope, cost money, publish externally, or expose data.

## Progress record

Machine-readable milestone status and chronological notes live in `work/hex_machina_state.json`, maintained by `train.py`. Product code, test results, and deployed behavior remain the authoritative evidence. This section may contain short human-readable handoff notes, but should not duplicate the state file.

Initial state: specification established; product implementation not yet scaffolded.
