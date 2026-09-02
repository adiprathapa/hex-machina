# Hex Machina screenshot set

These 1280×720 captures come from the canonical local judge journey. The current set was regenerated on 2026-09-02 (commit 6dabc1d) against the reworked layout; the git history of the three JPGs records every recapture. The capture script verifies zero console errors and zero cross-origin requests while producing them. Regenerate the complete set with `npm run capture:submission`.

## 01: Failure diagnosis

![Failure diagnosis with the highlighted causal path and the tool feed](01-failure-diagnosis.jpg)

The initial cast floods the room. The spell header reads **Side effect detected**, the verdict reads **Cast failed** beside **Twelve ducks. One indoor lake.**, and the highlighted path runs from Moonwell through Multiply, Summon ducks, and Pour into The room. The tool feed records `explain_side_effect` proving a 4-edge minimal causal subgraph and `trace_effect` tracing one ordered path with no cycles or type violations. The Familiar's two-hop suspect ranking sits folded to its **Advisory** heading above the feed; it never replaces the deterministic explanation.

## 02: Constraint-aware patch

![Sacred duck constraint and Give the ducks umbrellas patch preview](02-constraint-aware-patch.jpg)

`Summon ducks` carries the visible **Lock** badge of its sacred constraint. The proposed **Give the ducks umbrellas** patch shows rank 1, eight edits, and a one-of-two eligible candidate proof before any mutation occurs, and the tool feed records `set_sacred_constraint` followed by `propose_spell_patch`.

## 03: Successful recast

![Stable repaired graph with umbrella ducks and blooming moonflower](03-successful-recast.jpg)

The applied v3 graph activates `Umbrella` and `Bloom`, targets the Moonflower, and keeps all twelve ducks under their **Lock**. The spell header reads **Stable** and the verdict reads **Verified** beside **The moonflower blooms**, with the summary "Stable cast: twelve umbrella-equipped ducks water the Moonflower and the room remains dry." The tool feed records `simulate_cast` and `apply_spell_patch`, and the Familiar's read confirms that every promise survived the repair.
