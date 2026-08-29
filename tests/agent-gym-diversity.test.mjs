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
  const { testStructuresUnseenInTraining } = report.structuralDiversity;

  // This is the guard, not the finding. Adding a scenario family raises the
  // structure count, but that alone is not generalization evidence: the scope
  // only widens when the test split contains a structure training never saw.
  if (testStructuresUnseenInTraining > 0) {
    assert.equal(report.heldOutScope, "structural");
    assert.match(report.supportedClaim, /never contained/);
  } else {
    assert.equal(report.heldOutScope, "identifier-and-layout");
    assert.match(report.supportedClaim, /not evidence of structural generalization/);
  }
});

test("counting structures is not mistaken for holding them out", () => {
  const report = measureAgentGymFamilyDiversity();

  // Two families exist, so two structures exist — and both appear on both
  // sides of the split. More families is not the same as a held-out family.
  assert.ok(report.familyIds.length >= 2, "more than one family is generated");
  assert.ok(report.structuralDiversity.distinctStructures >= 2);
  assert.equal(report.structuralDiversity.testStructuresUnseenInTraining, 0);
  assert.equal(report.heldOutScope, "identifier-and-layout");
  assert.equal(
    report.structuralDiversity.structuresInTest <= report.structuralDiversity.structuresInTrain,
    true,
    "every test structure is also a training structure",
  );
});

test("the diversity measurement is deterministic", () => {
  assert.deepEqual(measureAgentGymFamilyDiversity(), measureAgentGymFamilyDiversity());
});
