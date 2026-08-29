# Hex Machina

**Magic is just code with worse documentation.**

Hex Machina is an agent-evaluation environment disguised as a graph-native cooperative spell game. A person and an agent share the same executable canvas: the person decides what must remain magical, while the agent traces causal failures and searches for the smallest valid repair. Every semantic action becomes a scored, exportable transition, so the playful judge journey doubles as a deterministic test of tool use, causal reasoning, intent preservation, and safe mutation.

In the opening lesson, a rain spell intended for a rare Moonflower multiplies before it has a bounded target. Twelve lunar ducks appear and flood the observatory. A conventional optimizer would delete the duck branch. The player refuses: “The ducks are funny. They stay.” That subjective preference becomes a sacred constraint in the graph. The agent must find a stranger solution—give the ducks umbrellas, redirect their rain onto the Moonflower, and recast without flooding the room.

## Why WebMCP matters

The spell canvas is not a picture for an agent to guess at. Hex Machina exposes seven narrow semantic tools for inspection, simulation, diagnosis, human-authored constraints, patch planning, and atomic patch application. Every tool call operates on stable node and edge identifiers and returns structured evidence that the interface can visualize.

The browser application remains the source of truth. It validates every mutation, rejects stale patches, simulates outcomes deterministically, and makes agent activity visible. The same handlers power both WebMCP and the built-in local spell console, so the game remains playable in browsers without Site Tools.

## Human-agent collaboration

- **Human:** declares taste, humor, and non-negotiable intent.
- **Agent:** traverses the graph, traces effects, and searches constrained repairs.
- **Application:** validates state, simulates consequences, and explains exact changes.

The collaboration is consequential rather than cosmetic: protecting the ducks produces a different valid graph and a different ending than allowing their removal.

## From game to agent gym

The graph is the observation, the seven WebMCP tools are the action space, and the application-owned handlers are the transition function. A visible 23-point rubric rewards evidence gathering, causal proof, constraint capture, safe preview, atomic repair, and final verification; invalid calls and premature writes are penalized. The same instrumented handlers serve the UI and visiting agents, and the complete JSON trajectory can be exported for evaluation or dataset experiments.

The research layer contains 48 deterministic variants across disjoint 32/8/8 train, validation, and test splits. Every variant remaps opaque IDs, order, layout, effect ID, and prompt wording. An inspection-driven policy still earns 23/23 on held-out variants, while a memorized training ID fails safely. This demonstrates within-family grounding, not generalized RL training; different simulator rules and semantic families remain the next research step.

A reproducible benchmark command runs the transparent reference policy across all 48 tasks and emits per-episode JSON receipts plus split means. This makes environment drift visible without presenting the scripted baseline as a learned result.

## Technical highlights

- Typed directed multigraph with seven rune and seven edge categories
- Human-editable typed ports with visible compatibility and atomic versioned connections
- Deterministic graph simulation and ordered event traces
- Minimal responsible-subgraph diagnosis
- Constraint-aware patch search with atomic, versioned, one-step reversible writes
- Narrow JSON schemas and honest read/write annotations
- Visible tool activity and patch evidence
- Keyboard-accessible controls, reduced-motion support, and responsive fallback
- No OpenAI API key required
- Experimental two-round Familiar graph network that ranks suspicious runes while leaving the deterministic simulator authoritative
- Deterministic Agent Gym reset/step protocol with visible rewards and exportable trajectories

## Built with

TypeScript, React, vinext, Cloudflare-compatible Sites output, WebMCP, Node test runner, a small deterministic graph engine, and an optional frozen-weight message-passing Familiar.

## Submission assets

- [`video/hex-machina-demo.mp4`](video/hex-machina-demo.mp4) — reproducible narrated 75-second judge walkthrough
- [`video/captions.srt`](video/captions.srt) — accessible English caption sidecar
- [`screenshots/01-failure-diagnosis.jpg`](screenshots/01-failure-diagnosis.jpg) — failed cast, deterministic diagnosis, and advisory Familiar ranking
- [`screenshots/02-constraint-aware-patch.jpg`](screenshots/02-constraint-aware-patch.jpg) — sacred duck constraint and reviewable patch preview
- [`screenshots/03-successful-recast.jpg`](screenshots/03-successful-recast.jpg) — Stable v3 graph, blooming Moonflower, and visible tool history
- [`demo-script.md`](demo-script.md) — timed 75-second judge walkthrough
