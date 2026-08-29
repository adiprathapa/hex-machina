# Devpost submission copy

## Project name

Hex Machina

## Tagline

An agent gym where humans decide what matters and agents prove the smallest repair.

## Short description

Hex Machina is an agent-evaluation environment disguised as a graph-native spell game. A person contributes taste—“the ducks must stay”—while a browser agent inspects, traces, simulates, and repairs the same executable spell through seven WebMCP tools. Those calls form a deterministic, scored, exportable trajectory.

## Why this is a strong fit for WebMCP

Most agents have to infer application state from pixels and imitate clicks. That is especially brittle in a graph editor, where direction, type, version, and causality matter more than position. Hex Machina exposes the spell as a semantic, versioned artifact instead.

Seven narrow WebMCP tools let the agent inspect the exact graph, trace a side effect, run deterministic simulations, explain the smallest responsible subgraph, record a human-authored sacred constraint, rank valid repairs, and atomically apply an approved patch. Focused inspection never hands the agent dangling references or a pre-solved diagnosis: it separates the closed selected subgraph from boundary edges and returns only high-level scenario status. The trace is a bounded graph traversal, not a prose guess: it returns the complete ordered Moonwell → Multiply → Summon ducks → Pour → Room path, all responsible edges, and explicit cycle/type evidence. The explanation is also executable evidence rather than a prose claim: it returns the typed five-rune/four-edge subgraph, the positive route facts, the absence of an Umbrella route, and four counterfactual simulations proving every responsible edge is necessary. A repair can first be simulated by its bounded patch ID: the result proves the editor was not mutated, and the interface visibly labels the stable prediction as unapplied. The tools return stable node and edge IDs, ordered events, cast assertions, before/after evidence, minimality evidence, and a stale-safe revert token. The browser agent works with the application’s source of truth rather than reconstructing it from the interface.

## How it creates a better user experience

The agent does not disappear into a chat transcript. Its work is visible on the shared canvas: inspected runes select, causal paths glow, constraints become physical pins, and every proposed connection, disconnection, and rune activation appears both in an eight-step review ledger and as a pending graph overlay before approval. Crucially, the human card renders the exact structured ledger returned to the agent; simulation, application, and rollback repeat that receipt so review cannot silently drift from execution. Mutations advance the graph version, and verification casts animate the outcome. The same shared handlers power WebMCP, human controls, and a local fallback console, so the experience remains understandable in an ordinary browser.

Every write is bounded and reversible. The agent can apply only a current application-generated patch ID—not arbitrary graph operations. The proposal names its exact graph-version, live-edge, dormant-rune, and sacred-lock preconditions; the approval card shows them, application revalidates them before cloning, and the result returns what was checked. The human can undo the latest unchanged patch without losing their sacred constraint.

## What people and agents can do together

The opening spell should water a Moonflower, but `Multiply` executes before a target is bounded. Twelve lunar ducks flood the observatory. A purely mechanical optimizer ranks a six-edit repair that bypasses the duck branch.

The person contributes something the graph cannot infer: “The ducks are funny. They stay.” That preference becomes an executable constraint. The cheaper candidate is now ineligible, so the agent ranks an eight-edit Umbrella route first. All twelve ducks survive, their rain reaches the Moonflower, the room stays dry, and the flower blooms.

This is the central thesis: graph interfaces let people and agents negotiate executable intent. The same pattern applies beyond games to creative tools, workflow builders, data pipelines, and other stateful systems where a person’s subjective constraints are essential but impossible for an optimizer to guess.

## Why it is more than a game

Hex Machina also exposes a headless Agent Gym protocol. The typed graph is the observation, the seven tools are the action space, and the shared application handlers define deterministic transitions. A nine-milestone, 23-point rubric rewards grounding, failure observation, causal tracing, explanation, intent preservation, safe patch preview, atomic application, and final verification. Invalid calls score −2; mutating before explaining scores an additional −5. The visible scorecard updates for both UI and WebMCP calls, and a complete trajectory can be exported as JSON.

Two semantic families contain 72 deterministic tasks: 48 Moonflower carrier-path variants across 32/8/8 splits and 24 Resonant Aviary feedback-cycle variants across 16/4/4 splits. Node, edge, and effect IDs are opaque and remapped per task; serialized order, layout, and prompt wording also change. Public observations deliberately omit the simulator's role map, causal rule ID, answer-key edges, rule-revealing family/scenario names, and pre-cast diagnostic assertions. Tests prove that a transparent policy can ground protected intent from natural-language constraints plus inspected rune text and earn 23/23 on held-out variants from both rules, while a memorized training ID is rejected without mutation. That is meaningful cross-rule grounding evidence, not a claim of broad transfer or reinforcement-learning gains.

The reproducible benchmark command runs the transparent reference policy over all 72 variants in two distinct causal families and emits JSON episode receipts and split means. It currently reports 72/72 completions at 23/23. Moonflower requires repairing an unshielded amplified carrier path; Resonant Aviary requires detecting and breaking a reachable directed feedback cycle. A held-out contrast suite proves that the reward separates grounded completion (23), unsafe mutation-first completion (18), safe but incomplete diagnosis (6), and canonical-ID memorization (−8); its aggregate results are visible in the product. A JSONL exporter emits replay-complete transitions with observations, scalar rewards, termination/truncation flags, state keys, results, errors, and variant metadata. An independent bounded verifier reconstructs each task and replays every action through production handlers; altered metadata, actions, rewards, observations, results, terminal scores, or duplicate scenarios make it exit nonzero. A strict streaming JSONL service and dependency-free Python adapters let an external trainer drive those same production transitions online as one environment or as isolated parallel vectors with Gymnasium-shaped reset/step results. Invalid calls are scored without crashing the rollout, and unfinished episodes truncate deterministically at 32 actions. These validate the environment and scripted controls, not a learned-policy result.

## How WebMCP was implemented

- `document.modelContext.registerTool()` is feature-detected and registers exactly seven lifecycle-scoped tools.
- All schemas are narrow JSON objects with described, bounded fields and `additionalProperties: false`.
- Five tools are honestly annotated read-only; two are reversible writes. Application-owned output is marked trusted.
- Registered callbacks, visible UI actions, and the fallback console invoke the same runtime-validated handlers.
- The React adapter reads current graph state at execution time and emits typed presentation events so agent calls visibly update the canvas.
- A pure deterministic simulator and bounded graph-rewrite solver remain authoritative. The optional two-round Familiar GNN only ranks inspection targets.
- A shared-handler instrumenter records Agent Gym rewards and trajectories without creating a second execution path.

## Judging criteria

### WebMCP leverage

WebMCP is the collaboration layer, not a decorative integration. The canonical journey needs all seven tools, exact graph IDs, visible semantic results, two reversible writes, fresh-state execution, and constraint-aware repair.

### Execution

The project is a complete responsive game and split-aware agent-evaluation environment with a typed graph editor, 72 deterministic task variants across two causal rules, failure and success spectacle, visible scoring, exportable trajectories, accessible keyboard and touch behavior, local fallback, reset and undo, security headers, zero runtime third-party requests, production packaging, screenshots, and a narrated 75-second demo.

### Potential impact

Hex Machina gives builders and users a concrete model for agent-native interfaces: expose structured application state, let people author subjective constraints, make proposals reviewable, and require the application to prove every mutation. This replaces fragile pixel automation with trustworthy collaboration.

### Creativity and ambition

The app turns graph debugging into magical comedy without reducing WebMCP to a novelty. The ducks are both the joke and the proof: human taste changes the eligible solution space, and the final graph visibly preserves that intent.

## How to test

1. Open the live URL in ChatGPT’s in-app browser or WebMCP-enabled Chrome.
2. Reset the lesson if it is not at graph v1.
3. Give the browser agent this exact prompt:

```text
Inspect my spell and cast it. Explain why it failed, but do not change anything yet. The ducks are funny, so preserve them as a sacred constraint. Find the smallest repair that waters the moonflower without flooding the room, show me the proposed patch, apply it, and cast the spell again.
```

Expected result: seven tools are discoverable; the initial cast floods the room with twelve ducks; the agent pins the duck constraint, proposes the rank-one eight-edit Umbrella patch with a complete visual operation ledger, applies it, and reaches **Stable** at graph v3 with all twelve ducks preserved.

## Build provenance

Hex Machina is a new project created during the challenge period. Its first commit is `c661551` at 2026-08-26 22:55 EDT, and the complete timestamped history is preserved in the repository.

## Submission links

The release operator must copy the three authorized public URLs from `release-evidence.json` into the Devpost form:

- Working live URL
- Public GitHub repository with a visible open-source license
- Public YouTube demo with audio

Do not submit until all three external gates pass and full `python3 prepare.py` is green.

After the September 3 deadline, freeze the submitted Devpost entry, repository, and live site for the full judging period. Continue any later development only in an unsubmitted fork.
