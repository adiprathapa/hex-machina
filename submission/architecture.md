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
- `src/scenarios/moonflower.ts`: canonical deterministic fixture with stable IDs and layout coordinates.
- `src/simulator/cast.ts`: pure spell execution producing ordered events, side effects, assertions, and success state.
- `src/solver/repair.ts`: failure explanation, bounded candidate generation, sacred-constraint handling, and patch preview.
- `src/tools/handlers.ts`: runtime-validated semantic operations independent of the browser adapter, including stale-safe one-use patch rollback; TypeScript types are never treated as an agent-input security boundary.
- `tests/browser-journey.test.mjs`: boots the built production server in system Chrome and proves the full failure, diagnosis, sacred-constraint, minimal-repair, stable-recast, reset, mobile, and keyboard journey without console errors.
- `src/tools/webmcp.ts`: guarded, abort-scoped WebMCP registration with narrow schemas, human-readable titles, and honest annotations.
- `src/familiar/gnn.ts`: optional two-round frozen-weight message passing that ranks inspection targets without influencing simulation or mutation.
- `app/HexMachina.tsx`: visual canvas, local fallback controls, visible constraints, patch review, and activity evidence.

## Mutation protocol

1. `propose_spell_patch` computes available patches for the current graph version.
2. The agent receives only versioned patch IDs plus operations and predicted outcomes.
3. `apply_spell_patch` accepts a patch ID, not an arbitrary patch object.
4. The application recomputes that patch against current state.
5. A stale or unavailable ID fails without mutation.
6. The selected patch applies to a clone and must pass graph validation.
7. The application commits the new graph atomically and immediately runs a verification simulation.

Manual human edits use the same domain invariants through `connectRunes`. The canvas derives compatible target ports from `getValidEdgeTypes`, collects an explicit edge category, rejects duplicates and invalid endpoint categories, activates linked dormant runes, and advances the graph version only after the cloned graph validates.

## Determinism

The scenario contains a fixed seed, stable IDs, sorted serialization, and pure simulation. Repeated casts of the same graph produce deeply equal results. This keeps tool evidence reproducible and makes demo failure modes debuggable.

## Browser compatibility

Registration is feature-detected through `document.modelContext?.registerTool`. Each page mount owns an `AbortController`, so React development remounts and real navigation unregister all seven names before another registration attempt. When WebMCP is unavailable, the complete guided local console invokes the identical handlers. No OpenAI API key or embedded model call is needed.

## Familiar experiment

After a failed deterministic cast, Moth projects bounded simulator evidence into scalar rune features and performs two directed message-passing rounds over the live graph. A softmax readout ranks three inspection candidates. The model is explicitly advisory, deterministic, dependency-free, and removable with `NEXT_PUBLIC_FAMILIAR_GNN=off`; the simulator and causal trace remain authoritative.
