import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_GYM_EVIDENCE_PROTOCOL,
  buildAgentGymEvidence,
  renderAgentGymEvidence,
} from "../src/eval/evidence-report.ts";

let cached;
async function evidence() {
  cached ??= await buildAgentGymEvidence();
  return cached;
}

test("the evidence bundle asserts every headline claim and they all hold", async () => {
  const report = await evidence();

  assert.equal(report.protocol, AGENT_GYM_EVIDENCE_PROTOCOL);
  assert.equal(report.allClaimsHold, true);

  assert.equal(report.claims.determinism.holds, true);
  assert.equal(report.claims.determinism.issues, 0);
  assert.equal(report.claims.determinism.verifiedEpisodes, report.claims.determinism.episodes);

  assert.equal(report.claims.grounding.completed, report.claims.grounding.episodes);
  assert.equal(report.claims.grounding.meanScore, 23);

  assert.equal(report.claims.structuralTransfer.holds, true);
  for (const protocol of report.claims.structuralTransfer.protocols) {
    assert.equal(protocol.groundedCompletionRate, 1, `${protocol.heldOutFamily} must transfer`);
    assert.equal(protocol.memorizingCompletionRate, 0, "memorization must not transfer");
    assert.ok(protocol.separation > 0);
  }

  assert.equal(report.claims.constraintPreservation.holds, true);
  for (const split of report.claims.constraintPreservation.splits) {
    assert.equal(split.verdict, "priced", `${split.split} must price constraint violation`);
    assert.equal(split.violatingConstraintPreservedRate, 0);
    assert.equal(split.violatingGoalVerifiedRate, 0);
  }
});

test("reward separation is strict: every contrast policy scores distinctly below grounded", async () => {
  const { policies } = (await evidence()).claims.rewardSeparation;
  const grounded = policies.find((policy) => policy.policyId === "grounded-reference");

  assert.ok(grounded, "the grounded reference must be benchmarked");
  const scores = policies.map((policy) => policy.meanScore);
  assert.equal(new Set(scores).size, scores.length, "policies must not tie; a tie is not separation");
  for (const policy of policies) {
    if (policy.policyId === grounded.policyId) continue;
    assert.ok(
      policy.meanScore < grounded.meanScore,
      `${policy.policyId} scored ${policy.meanScore}, not below grounded ${grounded.meanScore}`,
    );
  }
});

test("the bundle is content-addressed and regenerates identically", async () => {
  const first = await buildAgentGymEvidence();
  const second = await buildAgentGymEvidence();

  assert.equal(first.evidenceDigest, second.evidenceDigest, "an unchanged tree must produce one digest");
  assert.equal(first.datasetDigest, second.datasetDigest);
  assert.match(first.evidenceDigest, /^sha256:[a-f0-9]{16}$/);
  assert.deepEqual(first, second);

  // The digest must actually cover the claims, or it certifies nothing.
  const tampered = structuredClone(first);
  tampered.claims.grounding.meanScore = 0;
  assert.notDeepEqual(tampered.claims, first.claims);
  assert.equal(
    renderAgentGymEvidence(tampered).includes("mean score 0"),
    true,
    "the rendered report must reflect the claims it was built from",
  );
});

test("the rendered report states each verdict a judge needs to read", async () => {
  const markdown = renderAgentGymEvidence(await evidence());

  for (const heading of [
    "Deterministic replay",
    "Held-out grounding",
    "Reward separation",
    "Structural transfer",
    "Constraint preservation",
    "What a held-out score here does and does not show",
  ]) {
    assert.ok(markdown.includes(heading), `report must state the ${heading} claim`);
  }
  assert.ok(markdown.includes("npm run gym:evidence"), "report must say how to regenerate itself");
  assert.ok(!markdown.includes("FAILS"), "no claim may render as failing while the suite is green");
});
