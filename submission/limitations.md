# Current limitations and future work

## Intentional scope

- The submission contains one highly polished deterministic lesson rather than an open-ended campaign.
- Patch search uses a bounded catalog of semantically meaningful repairs for the Moonflower scenario.
- The graph layout is authored for legibility instead of using a general automatic layout engine.
- State is local to the live page and resets with the lesson.

## WebMCP availability

The full fallback experience works when the browser does not expose `document.modelContext`. Live Site Tools discovery depends on supported browser configuration and is verified separately from source-level registration tests.

## Familiar graph network

The optional Familiar is a tiny frozen-weight message-passing prototype, not a trained general-purpose model. It ranks likely inspection targets only after the deterministic simulator supplies bounded failure evidence. It never changes state, provides causal truth, or replaces the simulator. A future version could train the same interface on generated spell failures.

## Natural extensions

- Additional authored spell puzzles and rune types
- Import/export and shareable spell replays
- Drag-to-compose graph editing
- A learned Familiar ranking model trained on a larger corpus of generated spell failures
- Collaborative puzzle authoring
