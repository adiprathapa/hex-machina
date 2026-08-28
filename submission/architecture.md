# Architecture

## Trust boundary

```text
Human intent ─┐
              ├─> shared tool handlers ─> graph validation ─> deterministic simulator
WebMCP agent ─┘             │                                      │
                            └─> visible activity             verification evidence
```

Hex Machina does not ask an agent to own or infer application state. The client application owns a versioned `SpellGraph`; tools receive bounded inputs and call the same pure domain operations as the fallback interface.

## Modules

- `src/domain/spell.ts`: graph types, allowed connections, validation, stable serialization, cloning, and atomic patch application.
- `src/domain/patch-preview.ts`: deterministic translation from structural operations to the human-review ledger and canvas overlay.
- `src/scenarios/moonflower.ts`: canonical deterministic fixture with stable IDs and layout coordinates.
- `src/simulator/cast.ts`: pure spell execution producing ordered events, side effects, assertions, and success state.
- `src/solver/repair.ts`: failure explanation, bounded candidate generation, constraint filtering, edit-count ranking, and patch preview.
- `src/solver/trace.ts`: deterministic bounded directed traversal, ordered path evidence, cycle detection, and structural type diagnostics.
- `src/tools/handlers.ts`: runtime-validated semantic operations independent of the browser adapter, including a typed result-presentation channel and stale-safe one-use patch rollback; TypeScript types are never treated as an agent-input security boundary.
- `tests/browser-journey.test.mjs`: boots the built production server in system Chrome and proves the full failure, diagnosis, sacred-constraint, minimal-repair, stable-recast, reset, mobile, and keyboard journey without console errors.
- The same production-browser test supplies the `document.modelContext` registration contract, invokes all seven registered definitions as an agent would, and verifies that those calls drive the visible interface. This adapter harness complements—but does not replace—the pending live deployment discovery test.
- `src/tools/webmcp.ts`: guarded, abort-scoped WebMCP registration with narrow schemas, human-readable titles, and honest annotations.
- `src/familiar/gnn.ts`: optional two-round frozen-weight message passing that ranks inspection targets without influencing simulation or mutation.
- `app/HexMachina.tsx`: visual canvas, local fallback controls, visible constraints, per-operation patch review, and activity evidence.
- `worker/index.ts`: Cloudflare-compatible request boundary adding same-origin content, capability, referrer, framing, and MIME security policies to built responses.

The application has no database, object-storage binding, account surface, analytics, or runtime third-party request. The production-browser suite asserts that the complete human and registered-agent journeys remain same-origin.

## Mutation protocol

1. `propose_spell_patch` computes available patches for the current graph version.
2. The agent receives only versioned patch IDs plus operations, predicted outcomes, a structured human-readable operation ledger with summary counts, and explicit preconditions covering graph version, required live edges, required dormant runes, and required sacred locks.
3. `apply_spell_patch` accepts a patch ID, not an arbitrary patch object.
4. The application recomputes that patch against current state.
5. A stale or unavailable ID fails without mutation. Before cloning, every live-edge, dormant-rune, and sacred-lock precondition must still match; same-version structural drift also fails closed.
6. The selected patch then applies to a clone and must pass structural validation plus an independent reachability proof for every sacred node or edge.
7. The application commits the new graph atomically and immediately runs a verification simulation.

The canonical search evaluates two semantically distinct graph rewrites. Without a sacred constraint, a six-edit direct route ranks first. Protecting the ducks removes that candidate from eligibility, so an eight-edit Umbrella route ranks first and preserves the complete twelve-duck branch. The structured proposal reports rank, edit count, total candidates, eligible candidates, and satisfied constraints.

Before a write is approved, the shared proposal handler converts the exact application-generated operations into a stable ledger. The agent receives that ledger and the UI renders it directly; it does not maintain a second translation path. Removed edges remain visible in ember, proposed edges appear as aqua ghosts, and dormant nodes to be activated receive a distinct pending state. Safe simulation returns the same ledger, successful application echoes it as `appliedPatch`, and rollback echoes it as `revertedPatch`, so tests can prove one review receipt survives the entire transaction.

The approval card also renders the preflight facts as human evidence. Successful application returns the exact `validatedPreconditions` object alongside its before/after summaries, allowing an agent or judge to compare what was proposed with what the application actually checked.

`simulate_cast` can take that current patch ID and execute it against a cloned graph. The result returns the base version, simulated version, and an explicit `editorMutated: false` receipt. The UI preserves the failed live cast, labels the prediction **Unapplied simulation**, and keeps the canvas header at the base graph version until the separate write tool is invoked.

`trace_effect` walks active typed edges in stable ID order. It can trace the known outcome backward through its responsible subgraph or trace forward from a known source, stopping at caller-supplied bounds capped at depth 12 and five paths. Every response carries ordered node and edge sequences, terminal and completeness state, deduplicated responsible IDs, cycle evidence, graph validation errors, the applied bounds, and a truncation flag.

`explain_side_effect` turns the simulator's flood witness into a typed five-node/four-edge subgraph and ordered causal steps. It reports the four positive route premises plus the negative absence of a protective Umbrella route. To support the word “minimal” with executable evidence, it clones the graph four times, removes one responsible edge per clone, and records that the side effect disappears in every counterfactual without mutating live state.

`inspect_spell` derives current scenario state through the same pure simulator used by casting. Complete inspection returns all twelve runes and all edges. A focused inspection returns only edges whose endpoints are both present, puts incident cross-boundary connections in a separate `boundaryEdges` collection, and reports requested, returned, omitted, internal-edge, and boundary-edge counts. This prevents an agent from receiving dangling edge references while preserving enough context to expand its inspection deliberately.

Manual human edits use the same domain invariants through `connectRunes`. The canvas derives compatible target ports from `getValidEdgeTypes`, collects an explicit edge category, rejects duplicates and invalid endpoint categories, activates linked dormant runes, and advances the graph version only after the cloned graph validates.

## Determinism

The scenario contains a fixed seed, stable IDs, sorted serialization, and pure simulation. Repeated casts of the same graph produce deeply equal results. This keeps tool evidence reproducible and makes demo failure modes debuggable.

## Browser compatibility

Registration is feature-detected through `document.modelContext?.registerTool`. Each page mount owns an `AbortController`, so React development remounts and real navigation unregister all seven names before another registration attempt. When WebMCP is unavailable, the complete guided local console invokes the identical handlers. No OpenAI API key or embedded model call is needed.

## Familiar experiment

After a failed deterministic cast, Moth projects bounded simulator evidence into scalar rune features and performs two directed message-passing rounds over the live graph. A softmax readout ranks three inspection candidates. The model is explicitly advisory, deterministic, dependency-free, and removable with `NEXT_PUBLIC_FAMILIAR_GNN=off`; the simulator and causal trace remain authoritative.
