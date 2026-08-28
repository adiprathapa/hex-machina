# Devpost submission copy

## Project name

Hex Machina

## Tagline

A spell graph where humans decide what matters and agents prove the smallest repair.

## Short description

Hex Machina is a graph-native cooperative spell-debugging game. A person contributes taste—“the ducks must stay”—while a browser agent inspects, traces, simulates, and repairs the same executable spell through seven WebMCP tools.

## Why this is a strong fit for WebMCP

Most agents have to infer application state from pixels and imitate clicks. That is especially brittle in a graph editor, where direction, type, version, and causality matter more than position. Hex Machina exposes the spell as a semantic, versioned artifact instead.

Seven narrow WebMCP tools let the agent inspect the exact graph, trace a side effect, run deterministic simulations, explain the smallest responsible subgraph, record a human-authored sacred constraint, rank valid repairs, and atomically apply an approved patch. Focused inspection never hands the agent dangling references: it separates the closed selected subgraph from boundary edges and includes the current scenario assertions. The trace is a bounded graph traversal, not a prose guess: it returns the complete ordered Moonwell → Multiply → Summon ducks → Pour → Room path, all responsible edges, and explicit cycle/type evidence. The explanation is also executable evidence rather than a prose claim: it returns the typed five-rune/four-edge subgraph, the positive route facts, the absence of an Umbrella route, and four counterfactual simulations proving every responsible edge is necessary. A repair can first be simulated by its bounded patch ID: the result proves the editor was not mutated, and the interface visibly labels the stable prediction as unapplied. The tools return stable node and edge IDs, ordered events, assertions, before/after evidence, minimality evidence, and a stale-safe revert token. The browser agent works with the application’s source of truth rather than reconstructing it from the interface.

## How it creates a better user experience

The agent does not disappear into a chat transcript. Its work is visible on the shared canvas: inspected runes select, causal paths glow, constraints become physical pins, and every proposed connection, disconnection, and rune activation appears both in an eight-step review ledger and as a pending graph overlay before approval. Mutations advance the graph version, and verification casts animate the outcome. The same shared handlers power WebMCP, human controls, and a local fallback console, so the experience remains understandable in an ordinary browser.

Every write is bounded and reversible. The agent can apply only a current application-generated patch ID—not arbitrary graph operations. The proposal names its exact graph-version, live-edge, dormant-rune, and sacred-lock preconditions; the approval card shows them, application revalidates them before cloning, and the result returns what was checked. The human can undo the latest unchanged patch without losing their sacred constraint.

## What people and agents can do together

The opening spell should water a Moonflower, but `Multiply` executes before a target is bounded. Twelve lunar ducks flood the observatory. A purely mechanical optimizer ranks a six-edit repair that bypasses the duck branch.

The person contributes something the graph cannot infer: “The ducks are funny. They stay.” That preference becomes an executable constraint. The cheaper candidate is now ineligible, so the agent ranks an eight-edit Umbrella route first. All twelve ducks survive, their rain reaches the Moonflower, the room stays dry, and the flower blooms.

This is the central thesis: graph interfaces let people and agents negotiate executable intent. The same pattern applies beyond games to creative tools, workflow builders, data pipelines, and other stateful systems where a person’s subjective constraints are essential but impossible for an optimizer to guess.

## How WebMCP was implemented

- `document.modelContext.registerTool()` is feature-detected and registers exactly seven lifecycle-scoped tools.
- All schemas are narrow JSON objects with described, bounded fields and `additionalProperties: false`.
- Five tools are honestly annotated read-only; two are reversible writes. Application-owned output is marked trusted.
- Registered callbacks, visible UI actions, and the fallback console invoke the same runtime-validated handlers.
- The React adapter reads current graph state at execution time and emits typed presentation events so agent calls visibly update the canvas.
- A pure deterministic simulator and bounded graph-rewrite solver remain authoritative. The optional two-round Familiar GNN only ranks inspection targets.

## Judging criteria

### WebMCP leverage

WebMCP is the collaboration layer, not a decorative integration. The canonical journey needs all seven tools, exact graph IDs, visible semantic results, two reversible writes, fresh-state execution, and constraint-aware repair.

### Execution

The project is a complete responsive game with a typed graph editor, deterministic failure and success spectacle, accessible keyboard and touch behavior, local fallback, reset and undo, security headers, zero runtime third-party requests, production packaging, screenshots, and a narrated 75-second demo.

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
