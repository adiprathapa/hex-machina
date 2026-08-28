# WebMCP tool inventory

| Tool | Mode | Purpose | Verification evidence |
|---|---|---|---|
| `inspect_spell` | Read | Inspect the complete graph or a non-empty bounded node selection. Focused results contain only internal edges and separately identify boundary edges. | Graph version, stable IDs, constraints, desired outcome, filter counts, closed subgraph, boundary edges, and deterministic scenario status/assertions. |
| `trace_effect` | Read | Trace deterministic directed paths forward from a known source or into the active failure, with hard depth and path-count bounds. | Ordered node/edge paths, responsible IDs, completeness, cycles, type violations, bounds, and truncation state. |
| `simulate_cast` | Read | Simulate the live graph or an optional current application-generated patch ID without changing editor state. | Seed, ordered events, duck count, assertions, side effects, success, base and simulated graph versions, `editorMutated: false`, and the unchanged operation-ledger receipt for previews. |
| `explain_side_effect` | Read | Explain the flood from its smallest responsible subgraph. | Typed nodes/edges, ordered causal steps, positive and negative simulator premises, and a counterfactual edge-necessity proof. |
| `set_sacred_constraint` | Reversible write | Preserve or release the duck branch with a human-authored reason. | Before/after constraints and new graph version. |
| `propose_spell_patch` | Read | Search valid repairs under current constraints. | Rank, edit count, candidate and eligibility counts, satisfied constraints, raw operations, the canonical labeled operation ledger and summary, tradeoffs, predicted outcome, and explicit version/live-edge/dormant-rune/sacred-lock preconditions. |
| `apply_spell_patch` | Reversible write | Revalidate every precondition and apply a current patch ID atomically, or consume its one-use revert token while the graph is unchanged. | Validated preconditions, matching applied/reverted operation-ledger receipts, before/after graph summaries, verification cast, and stale-safe rollback evidence. |

All seven handlers are instrumented once by the Agent Gym layer before they are given to either the interface or WebMCP registration. Each invocation therefore records the same action input, before/after graph versions, mutation flag, result or error, and explained reward delta. The instrumenter observes behavior but never replaces validation, simulation, or mutation logic.

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
- Patch applications return one-use revert tokens; rollback fails closed after any intervening graph mutation and never discards the human's sacred constraint.
- Registrations are abort-scoped so unmounts, navigation, and React Strict Mode remounts cannot leave duplicate tool names behind.
