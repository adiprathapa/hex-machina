# Hex Machina

**Magic is just code with worse documentation.**

Hex Machina is a graph-native cooperative spell-debugging game built for WebMCP. A person and an agent share the same executable spell canvas: the person decides what must remain magical, while the agent traces causal failures and searches for the smallest valid repair.

In the opening lesson, a rain spell intended for a rare Moonflower multiplies before it has a bounded target. Twelve lunar ducks appear and flood the observatory. A conventional optimizer would delete the duck branch. The player refuses: “The ducks are funny. They stay.” That subjective preference becomes a sacred constraint in the graph. The agent must find a stranger solution—give the ducks umbrellas, redirect their rain onto the Moonflower, and recast without flooding the room.

## Why WebMCP matters

The spell canvas is not a picture for an agent to guess at. Hex Machina exposes seven narrow semantic tools for inspection, simulation, diagnosis, human-authored constraints, patch planning, and atomic patch application. Every tool call operates on stable node and edge identifiers and returns structured evidence that the interface can visualize.

The browser application remains the source of truth. It validates every mutation, rejects stale patches, simulates outcomes deterministically, and makes agent activity visible. The same handlers power both WebMCP and the built-in local spell console, so the game remains playable in browsers without Site Tools.

## Human-agent collaboration

- **Human:** declares taste, humor, and non-negotiable intent.
- **Agent:** traverses the graph, traces effects, and searches constrained repairs.
- **Application:** validates state, simulates consequences, and explains exact changes.

The collaboration is consequential rather than cosmetic: protecting the ducks produces a different valid graph and a different ending than allowing their removal.

## Technical highlights

- Typed directed multigraph with seven rune and seven edge categories
- Human-editable typed ports with visible compatibility and atomic versioned connections
- Deterministic graph simulation and ordered event traces
- Minimal responsible-subgraph diagnosis
- Constraint-aware patch search with atomic, versioned writes
- Narrow JSON schemas and honest read/write annotations
- Visible tool activity and patch evidence
- Keyboard-accessible controls, reduced-motion support, and responsive fallback
- No OpenAI API key required
- Experimental two-round Familiar graph network that ranks suspicious runes while leaving the deterministic simulator authoritative

## Built with

TypeScript, React, vinext, Cloudflare-compatible Sites output, WebMCP, Node test runner, a small deterministic graph engine, and an optional frozen-weight message-passing Familiar.
