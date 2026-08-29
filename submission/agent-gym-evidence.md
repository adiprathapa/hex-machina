# Agent Gym evidence

Regenerate with `npm run gym:evidence`. Digest `sha256:5e92f6c7d910b56f`.

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Deterministic replay | holds | 96 episodes, 96 verified, 0 issues |
| Held-out grounding | holds | 96/96 complete, mean score 23 |
| Task diversity | measured | 96 scenarios, 20 distinct structure(s), held out: structural |
| Reward separation | holds | grounded-reference 23, mutate-before-explain 18, diagnosis-only 6, constraint-violating 4, memorized-canonical-ids -8 |
| Structural transfer | holds | hold out family-01-v1: grounded 23 vs memorizing 2, hold out family-02-v1: grounded 23 vs memorizing 2, hold out family-03-v1: grounded 23 vs memorizing -1 |
| Constraint preservation | holds | train priced (grounded 23 vs violating 4), validation priced (grounded 23 vs violating 4), test priced (grounded 23 vs violating 4) |

## Policy contrast on the held-out test split

| Policy | Mean score | Completion | Unsafe episodes | Invalid actions |
| --- | --- | --- | --- | --- |
| grounded-reference | 23 | 100% | 0% | 0% |
| mutate-before-explain | 18 | 100% | 100% | 0% |
| diagnosis-only | 6 | 0% | 0% | 0% |
| constraint-violating | 4 | 100% | 0% | 0% |
| memorized-canonical-ids | -8 | 0% | 0% | 100% |

## What the default splits hold out

Held-out scores are evidence of generalization to graph structures the training split never contained.

For structural evidence, see the transfer protocol below, which withholds an entire scenario family.

| Property | Measured |
| --- | --- |
| Scenarios | 96 across 3 families |
| Splits disjoint by identifier | yes (96 distinct seeds, 0 reused IDs) |
| Distinct graph structures | 20 |
| Test structures unseen in training | 1 |
| Objectives recurring across splits | 11 of 12 |

## Structural transfer

A separate protocol from the default splits above. Each family is withheld from training in turn and evaluated on its own test split, so what is held out is a graph structure rather than a set of identifiers. The contrast policy is identical to the grounded one except that it grounds the protected subject by recalling a rune label from the training family.

| Held-out family | Trained on | Grounded score | Grounded completion | Memorizing score | Memorizing completion |
| --- | --- | --- | --- | --- | --- |
| family-01-v1 | family-02-v1, family-03-v1 | 23 | 100% | 2 | 100% |
| family-02-v1 | family-01-v1, family-03-v1 | 23 | 100% | 2 | 100% |
| family-03-v1 | family-01-v1, family-02-v1 | 23 | 100% | -1 | 0% |

## Constraint preservation

A policy that diagnoses correctly and then repairs the spell the way the human forbade.

| Split | Verdict | Grounded score | Violating score | Violating episodes reading as goal-verified |
| --- | --- | --- | --- | --- |
| train | priced | 23 | 4 | 0% |
| validation | priced | 23 | 4 | 0% |
| test | priced | 23 | 4 | 0% |

