# WebMCP tool inventory

| Tool | Mode | Purpose | Verification evidence |
|---|---|---|---|
| `inspect_spell` | Read | Inspect current graph, version, outcome, and constraints, optionally filtered to known node IDs. | Stable IDs and bounded node list. |
| `trace_effect` | Read | Trace the causal path behind the known active failure. | Responsible node and edge IDs. |
| `simulate_cast` | Read | Simulate the live graph or an optional current application-generated patch ID without changing editor state. | Seed, ordered events, duck count, assertions, side effects, success, base and simulated graph versions, and `editorMutated: false` for previews. |
| `explain_side_effect` | Read | Explain the flood from its smallest responsible subgraph. | Structured explanation plus exact nodes and edges. |
| `set_sacred_constraint` | Reversible write | Preserve or release the duck branch with a human-authored reason. | Before/after constraints and new graph version. |
| `propose_spell_patch` | Read | Search valid repairs under current constraints. | Rank, edit count, candidate and eligibility counts, satisfied constraints, operations, tradeoffs, and predicted outcome. |
| `apply_spell_patch` | Reversible write | Apply a current versioned patch ID atomically, or consume its one-use revert token while the graph is unchanged. | Before/after graph summaries, verification cast, and stale-safe rollback evidence. |

## Safety properties

- All schemas set `additionalProperties: false`.
- Every handler independently validates the runtime input object, allowed fields, primitive types, collection bounds, and known IDs; browser-side schema enforcement is not trusted.
- Scenario IDs use explicit enums or narrow patterns.
- Patch previews accept only a current bounded patch ID returned by `propose_spell_patch`; arbitrary graphs and operations are never accepted.
- Read tools declare `readOnlyHint: true`.
- Every tool declares the current standard annotations explicitly: reads use `readOnlyHint: true`, writes use `readOnlyHint: false`, and deterministic application-owned outputs use `untrustedContentHint: false`.
- Registered callbacks reject already-cancelled executions before invoking shared application logic.
- Agent-supplied graph operations are never accepted.
- Atomic patch application independently proves that every sacred node or edge remains reachable from an active source, even if a future solver candidate is wrong.
- Unknown nodes, side effects, empty reasons, oversized inputs, and stale patches fail safely.
- Patch applications return one-use revert tokens; rollback fails closed after any intervening graph mutation and never discards the human's sacred constraint.
- Registrations are abort-scoped so unmounts, navigation, and React Strict Mode remounts cannot leave duplicate tool names behind.
