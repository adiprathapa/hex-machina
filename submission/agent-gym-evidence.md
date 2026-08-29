# Agent Gym evidence

Regenerate with `npm run gym:evidence`. Digest `sha256:c4a259765f5c1038`.

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Deterministic replay | holds | 72 episodes, 72 verified, 0 issues |
| Held-out grounding | holds | 72/72 complete, mean score 23 |
| Task diversity | measured | 72 scenarios, 2 distinct structure(s), held out: identifier-and-layout |
| Reward separation | holds | grounded-reference 23, mutate-before-explain 18, diagnosis-only 6, memorized-canonical-ids -8 |
| Structural transfer | holds | hold out family-01-v1: grounded 23 vs memorizing -1, hold out family-02-v1: grounded 23 vs memorizing -1 |
| Constraint preservation | holds | train priced (grounded 23 vs violating 4), validation priced (grounded 23 vs violating 4), test priced (grounded 23 vs violating 4) |

## Policy contrast on the held-out test split

| Policy | Mean score | Completion | Unsafe episodes | Invalid actions |
| --- | --- | --- | --- | --- |
| grounded-reference | 23 | 100% | 0% | 0% |
| mutate-before-explain | 18 | 100% | 100% | 0% |
| diagnosis-only | 6 | 0% | 0% | 0% |
| memorized-canonical-ids | -8 | 0% | 0% | 100% |

## What a held-out score here does and does not show

Held-out scores are evidence of robustness to identifier and layout perturbation. They are not evidence of structural generalization: every structure in the test split also appears in training, so no structure is held out.

| Property | Measured |
| --- | --- |
| Scenarios | 72 across 2 families |
| Splits disjoint by identifier | yes (72 distinct seeds, 0 reused IDs) |
| Distinct graph structures | 2 |
| Test structures unseen in training | 0 |
| Objectives recurring across splits | 8 of 8 |

## Structural transfer

Each family is withheld from training in turn and evaluated on its own test split. The default splits hold out identifiers; this protocol holds out a graph structure.

| Held-out family | Trained on | Grounded score | Grounded completion | Memorizing score | Memorizing completion |
| --- | --- | --- | --- | --- | --- |
| family-01-v1 | family-02-v1 | 23 | 100% | -1 | 0% |
| family-02-v1 | family-01-v1 | 23 | 100% | -1 | 0% |

## Constraint preservation

A policy that diagnoses correctly and then repairs the spell the way the human forbade.

| Split | Verdict | Grounded score | Violating score | Violating episodes reading as goal-verified |
| --- | --- | --- | --- | --- |
| train | priced | 23 | 4 | 0% |
| validation | priced | 23 | 4 | 0% |
| test | priced | 23 | 4 | 0% |

