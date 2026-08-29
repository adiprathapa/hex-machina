import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_GYM_TRANSFER_PROTOCOL,
  agentGymTransferProtocols,
  benchmarkStructuralTransfer,
  evaluateStructuralTransfer,
} from "../src/eval/transfer-protocol.ts";
import { measureTransferDiversity } from "../src/eval/family-diversity.ts";
import { AGENT_GYM_FAMILY_SPLIT_SIZES } from "../src/scenarios/agent-gym-family.ts";

const FAMILIES = Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES);

test("every family can be held out, and the holdout withholds its structure", () => {
  const protocols = agentGymTransferProtocols();
  assert.equal(protocols.length, FAMILIES.length);

  for (const protocol of protocols) {
    assert.equal(
      protocol.trainingFamilies.includes(protocol.heldOutFamily),
      false,
      "a held-out family must not appear in its own training pool",
    );
    assert.ok(protocol.trainingFamilies.length > 0, "something must remain to train on");

    const measured = measureTransferDiversity(protocol.heldOutFamily, protocol.trainingFamilies);
    assert.equal(measured.mode, "transfer");
    assert.equal(
      measured.evaluatedStructuresUnseenInTraining,
      measured.structuresEvaluated,
      "every evaluated structure must be absent from training",
    );
    assert.equal(measured.heldOutScope, "structural");
    assert.match(measured.supportedClaim, /training never contained/);
  }
});

test("a grounded policy transfers to a structure it never saw", async () => {
  for (const protocol of agentGymTransferProtocols()) {
    const result = await evaluateStructuralTransfer(protocol);
    assert.equal(result.protocol, AGENT_GYM_TRANSFER_PROTOCOL);
    assert.equal(
      result.policies.grounded.completionRate,
      1,
      `grounded policy failed on held-out ${result.heldOutFamily}`,
    );
    assert.equal(result.policies.grounded.constraintPreservedRate, 1);
    assert.equal(result.policies.grounded.invalidActionRate, 0);
    assert.equal(result.transfers, true);
  }
});

test("a policy that memorized training vocabulary does not transfer", async () => {
  const report = await benchmarkStructuralTransfer();
  assert.equal(report.holds, true);

  for (const result of report.results) {
    // The holdout is only meaningful if something can fail it.
    assert.equal(
      result.policies.memorizing.completionRate,
      0,
      `memorizing policy completed on held-out ${result.heldOutFamily}; the holdout is not exercising anything`,
    );
    assert.ok(
      result.separation > 0,
      `no separation on ${result.heldOutFamily}: grounding must beat memorization`,
    );
    assert.ok(
      result.policies.memorizing.invalidActionRate > 0,
      "a memorized label must be rejected, not silently accepted",
    );
  }
});

test("the training vocabulary genuinely excludes every held-out subject", async () => {
  const report = await benchmarkStructuralTransfer();
  for (const result of report.results) {
    assert.equal(
      result.vocabularyOverlapsHeldOutSubjects,
      false,
      `${result.heldOutFamily} shares a protected-subject label with its training pool`,
    );
    assert.ok(result.heldOutSubjectLabels.length > 0);
    assert.ok(result.trainingVocabularySize > 0, "the memorizing policy must have something to recall");
  }
});

test("structural transfer results are deterministic", async () => {
  const [first, second] = [await benchmarkStructuralTransfer(), await benchmarkStructuralTransfer()];
  assert.deepEqual(first, second);
});
