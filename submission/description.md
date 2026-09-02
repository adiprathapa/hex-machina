# Hexmend

**Magic is just code with worse documentation.**

Hexmend is an agent-evaluation environment disguised as a graph-native cooperative spell game. A person and an agent share the same executable canvas: the person decides what must remain magical, while the agent traces causal failures and searches for the smallest valid repair. Every semantic action becomes a scored, exportable transition, so the playful judge journey doubles as a deterministic test of tool use, causal reasoning, intent preservation, and safe mutation.

In the opening lesson, a rain spell intended for a rare Moonflower multiplies before it has a bounded target. Twelve lunar ducks appear and flood the observatory. A conventional optimizer would delete the duck branch. The player refuses: “The ducks are funny. They stay.” That subjective preference becomes a sacred constraint in the graph. The agent must find a stranger solution: give the ducks umbrellas, redirect their rain onto the Moonflower, and recast without flooding the room.

## Why WebMCP matters

The spell canvas is not a picture for an agent to guess at. Hexmend exposes seven narrow semantic tools for inspection, simulation, diagnosis, human-authored constraints, patch planning, and atomic patch application. Every tool call operates on stable node and edge identifiers and returns structured evidence that the interface can visualize.

The browser application remains the source of truth. It validates every mutation, rejects stale patches, simulates outcomes deterministically, and makes agent activity visible. The same handlers power both WebMCP and the built-in local spell console, so the game remains playable in browsers without Site Tools.

## Human-agent collaboration

- **Human:** declares taste, humor, and non-negotiable intent.
- **Agent:** traverses the graph, traces effects, and searches constrained repairs.
- **Application:** validates state, simulates consequences, and explains exact changes.

The collaboration is consequential rather than cosmetic: protecting the ducks produces a different valid graph and a different ending than allowing their removal.

## From game to agent gym

The graph is the observation, the seven WebMCP tools are the action space, and the application-owned handlers are the transition function. A visible 23-point rubric rewards evidence gathering, causal proof, constraint capture, safe preview, atomic repair, and final verification; invalid calls and premature writes are penalized. The same instrumented handlers serve the UI and visiting agents, and the complete JSON trajectory can be exported for evaluation or dataset experiments.

The research layer contains 96 deterministic variants in three causal families: Moonflower's 48 carrier-path tasks use 32/8/8 train/validation/test splits, while Resonant Aviary's 24 feedback-cycle tasks and Clockwork Orchard's 24 temporal-guard tasks each use 16/4/4. Every variant remaps opaque IDs, order, layout, effect ID, and prompt wording, then activates one to three seeded typed decoy edges outside the private answer-key route. This yields at least three visible topologies per family rather than repeating one graph under new IDs. Agent-visible observations omit private simulator roles, causal rule IDs, and answer-key edges. A transparent policy grounds protected intent from natural-language constraints plus inspected rune text and still earns 23/23 on held-out variants from all three rules, while a memorized training ID fails safely. This demonstrates cross-rule grounding and distractor rejection, not generalized RL training.

A reproducible benchmark command runs the transparent reference policy across all 96 tasks and emits per-episode JSON receipts plus split means. A contrast suite proves reward separation on held-out tasks: grounded completion scores 23, unsafe mutation-first completion 18, safe but incomplete diagnosis 6, constraint-violating completion 4, and canonical-ID memorization −8. The train exporter turns those controls into 64 verifier-backed group-relative records: five trajectories per task, centered advantages of 14.4/9.4/−2.6/−4.6/−16.6, and all ten positive-margin chosen/rejected pairs. A dependency-free Python reader invokes the canonical verifier, streams one bounded group at a time, and projects all 640 train pairs without duplicating the corpus in memory; each pair retains its public reset, tool manifest, complete chosen/rejected trajectories, and exact margin. A separate v2 JSONL exporter produces standalone episodes for offline experiments: the human-visible task and constraint, initial public graph and state commitment, complete identifier-neutral action manifest, scalar rewards, terminal flags, before/after graphs, stable state keys, and explicit variant metadata. Independent verifiers reconstruct every task, regenerate labeled policies, authenticate reset context, and replay production actions, rejecting altered prompts, initial graphs/keys, tool definitions, rankings, advantages, pair margins, metadata, actions, rewards, observations, results, terminal scores, or duplicate scenarios. For online evaluation, a strict stdin/stdout JSONL service exposes correlated reset, step, describe, and snapshot operations. Its versioned action manifest includes the exact action envelope, seven descriptions and JSON Schemas, and five-read/two-write annotations; those definitions also generate browser WebMCP registration, eliminating a second hand-authored contract. Generic training schemas intentionally omit task-specific opaque identifiers. A bounded xorshift32 sampler maps a reset seed deterministically to a task across all families or within one selected family, records that choice in the reset receipt, and defaults only seeded resets to the train split. Dependency-free Python adapters expose seeded single and parallel vectorized Gymnasium-shaped resets while every slot delegates to isolated production handlers. This makes environment and dataset drift visible and external policy integration practical without presenting scripted controls as learned results.

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
- Deterministic Agent Gym reset/step protocol with visible rewards, offline datasets, and live Python rollouts

## Built with

TypeScript, React, vinext, Cloudflare-compatible Sites output, WebMCP, Node test runner, a small deterministic graph engine, and an optional frozen-weight message-passing Familiar.

## Submission assets

- [`video/hexmend-demo.mp4`](video/hexmend-demo.mp4): reproducible narrated 154.5-second registered-tool screencast
- [`video/captions.srt`](video/captions.srt): accessible English caption sidecar
- [`screenshots/01-failure-diagnosis.jpg`](screenshots/01-failure-diagnosis.jpg): failed cast, deterministic diagnosis, and advisory Familiar ranking
- [`screenshots/02-constraint-aware-patch.jpg`](screenshots/02-constraint-aware-patch.jpg): sacred duck constraint and reviewable patch preview
- [`screenshots/03-successful-recast.jpg`](screenshots/03-successful-recast.jpg): Stable v3 graph, blooming Moonflower, and visible tool history
- [`demo-script.md`](demo-script.md): timed 75-second judge walkthrough
