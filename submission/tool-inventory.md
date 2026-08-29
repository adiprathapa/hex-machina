# WebMCP tool inventory

| Tool | Mode | Purpose | Verification evidence |
|---|---|---|---|
| `inspect_spell` | Read | Inspect the complete graph or a non-empty bounded node selection. Focused results contain only internal edges and separately identify boundary edges. | Graph version, stable IDs, constraints, desired outcome, filter counts, closed subgraph, boundary edges, and high-level scenario status. Detailed cast assertions are intentionally withheld until `simulate_cast`. |
| `trace_effect` | Read | Trace deterministic directed paths forward from a known source or into the active failure, with hard depth and path-count bounds. | Ordered node/edge paths, responsible IDs, completeness, cycles, type violations, bounds, and truncation state. |
| `simulate_cast` | Read | Simulate the live graph or an optional current application-generated patch ID without changing editor state. | Seed, ordered events, duck count, assertions, side effects, success, base and simulated graph versions, `editorMutated: false`, and the unchanged operation-ledger receipt for previews. |
| `explain_side_effect` | Read | Explain the flood from its smallest responsible subgraph. | Typed nodes/edges, ordered causal steps, positive and negative simulator premises, and a counterfactual edge-necessity proof. |
| `set_sacred_constraint` | Reversible write | Preserve or release the duck branch with a human-authored reason. | Before/after constraints and new graph version. |
| `propose_spell_patch` | Read | Search valid repairs under current constraints. | Rank, edit count, candidate and eligibility counts, satisfied constraints, raw operations, the canonical labeled operation ledger and summary, tradeoffs, predicted outcome, and explicit version/live-edge/dormant-rune/sacred-lock preconditions. |
| `apply_spell_patch` | Reversible write | Revalidate every precondition and apply a current patch ID atomically, or consume its one-use revert token while the graph is unchanged. | Validated preconditions, matching applied/reverted operation-ledger receipts, before/after graph summaries, verification cast, and stale-safe rollback evidence. |

All seven handlers are instrumented once by the Agent Gym layer before they are given to either the interface or WebMCP registration. Each invocation therefore records the same action input, before/after graph versions, mutation flag, result or error, and explained reward delta. The instrumenter observes behavior but never replaces validation, simulation, or mutation logic. The serializable `hex-machina-tool-manifest/v1` definitions are also shared: Agent Gym exposes their identifier-neutral form to LLM runners, while WebMCP narrows the same schemas with canonical rune, source, effect, and sacred-target enums. Tests compare the registered definitions against that factory output, preventing description, schema, or annotation drift.

The headless family benchmark, JSONL exporter, independent replay verifier, streaming rollout service, and single/vector Python adapters invoke these handlers directly across 96 deterministic variants spanning three causal rules. They never use a parallel mock tool surface; the same validation, solver, simulator, reward recorder, and stale-write protection remain in force. Each task contains a seeded nonempty subset of three active, type-valid decoy edges outside the tracked causal route, so held-out graphs vary topology as well as IDs, order, layout, and wording. A versioned bounded sampler maps 32-bit reset seeds across all tasks or within one family, defaults seeded resets to training data, and returns its exact selection receipt; vector resets accept either a scalar seed expanded by slot or explicit seeds. A shared public-observation projection prevents `inspect_spell`, reset/step responses, replay transitions, JSONL, and Python adapters from exposing private simulator role assignments or answer-key edges. Neutral task identifiers and narrowed inspection status also prevent metadata and pre-cast assertions from naming the hidden rule. Every v2 dataset line carries its own public task prompt, initial graph/key, and identifier-neutral action manifest; the verifier authenticates that reset evidence before replaying actions through fresh production handlers, then rejects altered metadata, actions, observations, rewards, results, terminal scores, or duplicate scenarios. Vector slots own isolated handler instances and processes. The environment catches handler failures only at its rollout boundary, converting them into replayable negative-reward transitions while preserving normal UI/WebMCP error behavior.

Patch IDs have a second application-owned boundary: preview and write handlers accept only IDs returned by `propose_spell_patch` from that same handler instance at the current graph version. Guessing a valid-looking stable ID cannot skip human-review issuance, and any graph change revokes the issued set before mutation.

## Safety properties

- All schemas set `additionalProperties: false`.
- `inspect_spell` accepts one to twelve unique known rune IDs; omission means the complete graph, while an empty ambiguous selection is rejected.
- Every handler independently validates the runtime input object, allowed fields, primitive types, collection bounds, and known IDs; browser-side schema enforcement is not trusted.
- Scenario IDs use explicit enums or narrow patterns.
- Causal traversal defaults to depth 8 and three paths, cannot exceed depth 12 or five paths, and reports when evidence was truncated.
- Patch previews accept only a current bounded patch ID returned by `propose_spell_patch`; arbitrary graphs and operations are never accepted.
- Read tools declare `readOnlyHint: true`.
- Every tool declares the current standard annotations explicitly: reads use `readOnlyHint: true`, writes use `readOnlyHint: false`, and deterministic application-owned outputs use `untrustedContentHint: false`.
- Registered callbacks reject already-cancelled executions before invoking shared application logic.
- Agent-supplied graph operations are never accepted.
- Every application fails before cloning when its graph version, required live edges, dormant-rune states, or sacred locks have drifted—even if corrupted state reused the same version number.
- Atomic patch application independently proves that every sacred node or edge remains reachable from an active source, even if a future solver candidate is wrong.
- Unknown nodes, side effects, empty reasons, oversized inputs, and stale patches fail safely.
- Patch applications return one-use revert tokens; rollback fails closed after any intervening graph mutation and never discards the human's sacred constraint. Apply/revert pattern constants are shared by the manifest and runtime validator, including the temporal-guard family.
- Registrations are abort-scoped so unmounts, navigation, and React Strict Mode remounts cannot leave duplicate tool names behind.
