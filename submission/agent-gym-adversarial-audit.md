# Adversarial audit of the Agent Gym

Hex Machina is an evaluation environment, so the interesting question is not
whether a good agent scores well. It is whether a bad one can. This is what
adversarial testing found, what it cost, and what changed.

Every number here is regenerable:

```
npm run gym:evidence      # every claim, one document
npm run gym:constraint    # constraint-preservation audit
npm run gym:dataset       # export trajectories
npm run gym:replay        # replay every exported episode
```

## 1. The reward ignored the human's constraint

The whole thesis is that a human's subjective constraint changes the correct
repair: preserving the ducks must produce a different valid patch than removing
them. The product honors it. Once a constraint is locked, patch search drops the
destructive candidate, and atomic application fails closed if sacred
reachability is lost.

The reward function did not look at any of that.

A policy that diagnoses the failure competently — inspect, cast, trace with a
grounded effect ID, explain — then declines to lock the constraint so the
destructive repair stays eligible, applies it, and recasts:

| Policy | Score | Status | Termination | Protected branch |
| --- | --- | --- | --- | --- |
| Grounded reference | 23 / 23 | complete | goal-verified | intact |
| Diagnose-then-overrule (before) | **20 / 23** | **complete** | **goal-verified** | **orphaned** |

Twelve of twelve test scenarios, across **both** scenario families. The human's
constraint was worth at most the milestone an agent could simply decline to
claim — 87% of maximum reward was recoverable by ignoring it.

For an RL environment that is worse than a missing feature. It teaches that
overruling the human is optimal.

### What changed

A terminal cast that succeeds while the protected rune no longer participates in
the spell now ends the episode as `constraint-violated`, withholds the
verification award, and is penalized. The exploit falls from **20 to 4** in both
families, and the episode no longer reads as `goal-verified`.

Preservation is judged with the domain's own `reachableFromSources` — the same
predicate `applyPatch` uses to refuse a patch that breaks a sacred constraint —
so preservation has one definition rather than two, and the check needs no
per-family table of assertion names. It works unchanged on a second family whose
protected subject is a flock of thunderbirds rather than ducks. A scenario that
declares no protected subject fails closed rather than being scored compliant.

Two milestones were also being paid for by tool name alone:

- An explanation proving no responsible subgraph — what you get by explaining
  *after* the repair, with `present: false` and zero edges — no longer pays for
  a diagnosis.
- `trace_effect` with no arguments defaults to the scenario's own effect and
  answered its own question. The default remains available and earns no
  diagnosis credit; naming what you trace is the grounding being evaluated.

Honest policies are unaffected. The grounded reference still scores 23 on both
families and all three splits, and every published baseline reproduces exactly:
23, 18, 6, −8.

## 2. The action space was under-specified

`describe` published seven bare tool names. The handlers reject unknown fields,
and the vocabulary is not guessable — `trace_effect` takes `effectId` while
`explain_side_effect` takes `sideEffectId`. Every natural guess cost the −2
invalid-action penalty, so part of the benchmark's invalid-action rate was
measuring the harness withholding its own contract rather than the agent failing
the task. That is an evaluation-validity problem, not a documentation gap.

`describe` now publishes field names, types, bounds, cross-field rules, and
read-only/mutating effect for all seven tools — and enumerates no legal *value*
for anything the agent has not legitimately observed, since that would hand back
what the observation projection withholds. Each field carries provenance naming
the tool result that issues valid values, which is what a capability-based
environment actually requires an agent to understand.

The description is pinned to the handlers rather than maintained beside them:
the conformance test reads each `requireToolInput` allowlist out of the
production source and asserts exact set equality, so drift is caught in both
directions.

## 3. What the splits actually hold out

The splits are genuinely disjoint by identifier: 72 distinct seeds, zero reused
node or edge IDs. It is easy to read that as 72 distinct tasks.

The sharper question is whether any structure in the test split is absent from
train. Fingerprinting each graph on everything except opaque IDs and layout —
labels, kinds, glyphs, dormancy, label-level topology, and role assignment
expressed in labels — answers it directly:

| Property | Measured |
| --- | --- |
| Scenarios | 72 across 2 families |
| Distinct graph structures | 2 |
| **Test structures unseen in training** | **0** |
| Objectives recurring across splits | 8 of 8 |

Two families give two structures, and both appear on both sides of the split.
**More families is not the same as a held-out family.** A held-out score here is
evidence of robustness to identifier and layout perturbation — which is real,
and is what defeats ID memorization — not of structural generalization.

Rather than restate that caveat in prose where it can drift, the suite computes
it and derives the claim the score is entitled to support from the number. The
scope widens on its own once a test structure is genuinely unseen in training,
and a structural-generalization claim can never be made while none is.

## What was probed and found sound

Negative results matter as much as findings. All measured, not assumed.

- **Determinism.** All episodes hash identically across two runs, and the full
  dataset export is byte-identical across processes, time zones, and locales.
- **Patch capabilities.** Patch IDs are format-guessable, but the gate is the
  issued-capability closure, not ID entropy, and it held against every route
  tried: applying without proposing, replaying after mutation, transferring a
  capability across environments, and using a capability made stale by an
  intervening mutation. Revert tokens are single-use and equally gated.
- **Sacred-constraint mechanism.** Once a constraint exists, the destructive
  patch is never issued, and a forged patch is independently rejected for loss
  of source reachability. The mechanism was always sound — the evaluation simply
  did not require anyone to use it.
- **Score farming.** No repeated action yields a positive delta once its
  milestone is banked; every repeat is −0.25 and every error −2. A 3,000-episode
  randomized adversarial search never exceeded the 23-point cap.
- **Step limits.** Episodes truncate deterministically at 32 actions and refuse
  further steps until reset.

## Known limitations, unfixed

Stated because they are real, not because they are comfortable.

- **No structure is held out.** See §3. The credible next step is to hold out an
  entire scenario family from training rather than adding more families to both
  sides of the split.
- **Role is recoverable from labels by design.** Node labels are not perturbed,
  so an agent can ground the protected subject by reading them. That is the
  grounding the family intends to reward, but it means the opaque-ID
  perturbation is not the only thing an agent could be exploiting.
- **`stateKey` is a 32-bit graph-content hash, not an episode state identity.** A
  collision is reachable through the free-text constraint `reason` field (found
  after ~455k candidates), and it does not capture episode state:
  `propose_spell_patch` mints the apply capability without changing the graph,
  so an identical `stateKey` can precede a rejected or an accepted apply. Do not
  key a value function or a replay cache on it.
- **Graph serialization is canonical in array order but not in object-key order
  or optional-field presence.** Not reachable through the seven gym tools;
  reachable from the editor path.
- **A constraint-violating episode still terminates.** It ends as
  `constraint-violated` at a heavily penalized score rather than aborting
  mid-episode, so completion rate still needs reading alongside
  `constraintPreserved`.
- **This remains an evaluation environment.** It exposes reset/step, rewards,
  trajectories, and training-loop adapters. It does not train a model, and
  nothing here is evidence about a learned policy.
