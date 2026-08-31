import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_GYM_DIVERSITY_PROTOCOL,
  measureAgentGymFamilyDiversity,
} from "../src/eval/family-diversity.ts";

test("the splits are genuinely disjoint by identifier", () => {
  const report = measureAgentGymFamilyDiversity();
  assert.equal(report.protocol, AGENT_GYM_DIVERSITY_PROTOCOL);
  assert.equal(report.identifierDisjoint.holds, true);
  assert.equal(
    report.identifierDisjoint.distinctSeeds,
    report.scenarioCount,
    "no two scenarios may share a seed",
  );
  assert.equal(report.identifierDisjoint.reusedIdentifiers, 0, "no opaque ID may appear twice");
});

test("the claim a held-out score supports is chosen by the measurement, not asserted", () => {
  const report = measureAgentGymFamilyDiversity();
  const { causalStructuresUnseenInTraining } = report.structuralDiversity;

  // This is the guard, not the finding. Adding a scenario family raises the
  // structure count, but that alone is not generalization evidence: the scope
  // only widens when the test split contains a causal structure training never
  // saw. It once widened on a single test task whose only novelty was which
  // benign decoy edges happened to be active — the same causal problem wearing
  // a different coat — which silently promoted the whole claim.
  if (causalStructuresUnseenInTraining > 0) {
    assert.equal(report.heldOutScope, "structural");
    assert.match(report.supportedClaim, /never contained/);
  } else {
    assert.equal(report.heldOutScope, "identifier-and-layout");
    assert.match(report.supportedClaim, /not evidence of structural generalization/);
  }
});

test("counting structures is not mistaken for holding them out", () => {
  const report = measureAgentGymFamilyDiversity();
  const {
    distinctStructures,
    structuresInTrain,
    structuresInTest,
    testStructuresUnseenInTraining,
    causalStructuresUnseenInTraining,
  } = report.structuralDiversity;

  // Deliberately an invariant rather than today's numbers, which move whenever
  // the family generator gains diversity. Existing is not the same as being
  // held out: what earns the stronger scope is a test structure training never
  // saw, never a raised structure count.
  assert.ok(report.familyIds.length >= 1);
  assert.ok(distinctStructures >= structuresInTrain, "train structures are a subset of all structures");
  assert.ok(distinctStructures >= structuresInTest, "test structures are a subset of all structures");
  assert.ok(
    testStructuresUnseenInTraining <= structuresInTest,
    "cannot hold out more structures than are evaluated",
  );
  assert.equal(
    report.heldOutScope,
    causalStructuresUnseenInTraining > 0 ? "structural" : "identifier-and-layout",
    "scope must follow the unseen-causal-structure count and nothing else",
  );
  assert.ok(
    causalStructuresUnseenInTraining <= testStructuresUnseenInTraining,
    "ignoring decoys can only merge structures, never create new ones",
  );
});

test("decoy variation alone cannot promote the held-out claim", () => {
  const report = measureAgentGymFamilyDiversity();

  // The decoy subgraph is explicitly causally irrelevant to the tracked
  // failure, so two variants that differ only by which decoys are active pose
  // the same problem. If the raw count says a structure is held out but the
  // causal count says it is not, the scope must follow the causal count.
  if (report.structuralDiversity.testStructuresUnseenInTraining > 0
    && report.structuralDiversity.causalStructuresUnseenInTraining === 0) {
    assert.equal(
      report.heldOutScope,
      "identifier-and-layout",
      "a decoy-only difference is not a held-out structure",
    );
    assert.match(report.supportedClaim, /not evidence of structural generalization/);
  }
});

test("the diversity measurement is deterministic", () => {
  assert.deepEqual(measureAgentGymFamilyDiversity(), measureAgentGymFamilyDiversity());
});
