# Current limitations and future work

## Intentional scope

- The submission contains one highly polished deterministic lesson rather than an open-ended campaign.
- Patch search uses a bounded catalog of semantically meaningful repairs for the Moonflower scenario.
- The graph layout is authored for legibility instead of using a general automatic layout engine.
- State is local to the live page and resets with the lesson.

## WebMCP availability

The full fallback experience works when the browser does not expose `document.modelContext`. Live Site Tools discovery depends on supported browser configuration and is verified separately from source-level registration tests.

## GNN decision

The MVP intentionally uses deterministic graph algorithms. A GNN would not be the authoritative simulator or explanation layer. A future optional “Familiar” model could rank the rune most likely to cause an unintended effect across generated spell graphs, while the deterministic simulator remains ground truth.

## Natural extensions

- Additional authored spell puzzles and rune types
- Import/export and shareable spell replays
- Drag-to-compose graph editing
- A learned Familiar ranking model trained on simulated spell failures
- Collaborative puzzle authoring
