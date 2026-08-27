# WebMCP tool inventory

| Tool | Mode | Purpose | Verification evidence |
|---|---|---|---|
| `inspect_spell` | Read | Inspect current graph, version, outcome, and constraints, optionally filtered to known node IDs. | Stable IDs and bounded node list. |
| `trace_effect` | Read | Trace the causal path behind the known active failure. | Responsible node and edge IDs. |
| `simulate_cast` | Read | Simulate without changing editor state. | Seed, ordered events, assertions, side effects, and success. |
| `explain_side_effect` | Read | Explain the flood from its smallest responsible subgraph. | Structured explanation plus exact nodes and edges. |
| `set_sacred_constraint` | Reversible write | Preserve or release the duck branch with a human-authored reason. | Before/after constraints and new graph version. |
| `propose_spell_patch` | Read | Search valid repairs under current constraints. | Ranked patch operations, preserved intent, tradeoffs, and predicted outcome. |
| `apply_spell_patch` | Reversible write | Apply a current versioned patch ID atomically. | Before/after graph summaries and verification cast. |

## Safety properties

- All schemas set `additionalProperties: false`.
- Scenario IDs use explicit enums or narrow patterns.
- Read tools declare `readOnlyHint: true`.
- Writes declare `readOnlyHint: false` and `destructiveHint: false`.
- Agent-supplied graph operations are never accepted.
- Unknown nodes, side effects, empty reasons, oversized inputs, and stale patches fail safely.
