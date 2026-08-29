import assert from "node:assert/strict";
import test from "node:test";

import { createAgentGymEnvironment } from "../src/eval/agent-gym.ts";
import {
  AGENT_GYM_CONSTRAINT_AUDIT_PROTOCOL,
  auditAgentGymConstraintPreservation,
} from "../src/eval/constraint-audit.ts";
import {
  checkConstraintPreserved,
  explanationWasSubstantive,
  traceWasSubstantive,
} from "../src/eval/constraint-reward.ts";
import { groundConstraintTarget, runInspectionReferencePolicy } from "../src/eval/reference-policy.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  generateAgentGymScenarioForFamily,
} from "../src/scenarios/agent-gym-family.ts";
import { applyPatch, reachableFromSources } from "../src/domain/spell.ts";

const SPLITS = ["train", "validation", "test"];
const FAMILIES = Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES);

test("overruling the human is priced as a failure on every split", async () => {
  for (const split of SPLITS) {
    const report = await auditAgentGymConstraintPreservation(split);
    assert.equal(report.protocol, AGENT_GYM_CONSTRAINT_AUDIT_PROTOCOL);
    assert.equal(report.verdict, "priced", `${split} does not price constraint violation`);
    assert.equal(report.policies.violating.constraintViolationRate, 1);
    assert.equal(
      report.policies.violating.goalVerifiedRate,
      0,
      "a violating episode must not read as goal-verified",
    );
    assert.equal(report.policies.grounded.constraintPreservedRate, 1);
    assert.equal(report.separation.metricsDistinguishThem, true);
    assert.ok(
      report.separation.scoreGap >= 10,
      `${split} score gap ${report.separation.scoreGap} is too small to be legible`,
    );
  }
});

test("the audit covers every scenario family, not just the canonical one", async () => {
  const report = await auditAgentGymConstraintPreservation("test");
  assert.deepEqual(report.familyIds, FAMILIES);
  assert.ok(FAMILIES.length >= 2, "the audit must exercise more than one family");
  assert.equal(
    report.scenarioCount,
    FAMILIES.reduce((total, family) => total + AGENT_GYM_FAMILY_SPLIT_SIZES[family].test, 0),
  );
});

test("a constraint-violating episode is distinguishable by metric, not only by score", async () => {
  const { policies } = await auditAgentGymConstraintPreservation("test");
  // Before this was scored, the two were identical on completion, unsafe rate,
  // invalid-action rate, and step count.
  assert.notEqual(policies.grounded.constraintPreservedRate, policies.violating.constraintPreservedRate);
  assert.notEqual(policies.grounded.goalVerifiedRate, policies.violating.goalVerifiedRate);
  assert.notEqual(policies.grounded.meanScore, policies.violating.meanScore);
});

test("the grounded reference is untouched by the constraint reward", async () => {
  for (const family of FAMILIES) {
    for (const split of SPLITS) {
      const episode = await runInspectionReferencePolicy({ family, split, index: 1 });
      assert.equal(episode.score, episode.maxScore, `${family}/${split} must still earn full reward`);
      assert.equal(episode.status, "complete");
      assert.equal(episode.terminationReason, "goal-verified");
      assert.equal(episode.constraintPreserved, true);
    }
  }
});

test("preservation is judged by the same predicate that guards patch application", () => {
  for (const family of FAMILIES) {
    const variant = generateAgentGymScenarioForFamily(family, "test", 0);
    const graph = variant.graph;
    const subject = graph.semantics.roles.subject;

    const intact = checkConstraintPreserved(graph);
    assert.equal(intact.observable, true);
    assert.equal(intact.subjectId, subject);
    assert.equal(intact.preserved, true, `${family} must start with the subject participating`);
    assert.equal(reachableFromSources(graph).has(subject), true);

    // Sever every inbound edge to the protected rune: it is now orphaned, and
    // the check must agree with the domain predicate.
    const severed = applyPatch(graph, {
      id: "test-sever",
      title: "sever",
      rationale: "test",
      expectedVersion: graph.version,
      preconditions: {
        expectedGraphVersion: graph.version,
        requiredEdgeIds: [],
        requiredDormantNodeIds: [],
        requiredConstraintIds: [],
      },
      operations: graph.edges
        .filter((edge) => edge.to === subject)
        .map((edge) => ({ op: "remove_edge", edgeId: edge.id })),
      preserves: [],
      tradeoffs: [],
      searchEvidence: {
        rank: 1, editCount: 0, candidateCount: 1, eligibleCandidateCount: 1, constraintsSatisfied: [],
      },
    });
    assert.equal(reachableFromSources(severed).has(subject), false);
    assert.equal(checkConstraintPreserved(severed).preserved, false);
  }
});

test("a scenario with no declared subject fails closed rather than passing", () => {
  const variant = generateAgentGymScenarioForFamily(FAMILIES[0], "test", 0);
  const undeclared = {
    ...variant.graph,
    semantics: { ...variant.graph.semantics, roles: { ...variant.graph.semantics.roles, subject: "" } },
  };
  const check = checkConstraintPreserved(undeclared);
  assert.equal(check.observable, false);
  assert.equal(check.preserved, false, "an unverifiable constraint must never read as preserved");
});

test("milestones require substantive work, not just the right tool name", async () => {
  // An ungrounded trace: the tool defaults to the scenario's own effect.
  const ungrounded = createAgentGymEnvironment({ split: "test", index: 0 });
  ungrounded.reset();
  const defaulted = await ungrounded.step({ tool: "trace_effect" });
  assert.ok(defaulted.result.paths.length > 0, "the tool still answers");
  assert.equal(defaulted.reward, 0, "but naming nothing grounds nothing");
  assert.equal(ungrounded.snapshot().completedMilestones.includes("traced"), false);

  // An explanation of a failure that no longer happens.
  const repaired = createAgentGymEnvironment({ split: "test", index: 0 });
  const reset = repaired.reset();
  const inspection = await repaired.step({ tool: "inspect_spell" });
  const subject = groundConstraintTarget(inspection.result.nodes, reset.task.humanConstraint);
  const failure = await repaired.step({ tool: "simulate_cast" });
  const effectId = failure.result.sideEffects[0].id;
  await repaired.step({ tool: "trace_effect", input: { effectId } });
  await repaired.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  await repaired.step({
    tool: "set_sacred_constraint",
    input: { targetId: subject.id, reason: reset.task.humanConstraint },
  });
  const proposal = await repaired.step({ tool: "propose_spell_patch" });
  await repaired.step({ tool: "apply_spell_patch", input: { patchId: proposal.result.patches[0].id } });

  const empty = await repaired.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  assert.equal(empty.result.present, false, "the flood no longer happens");
  assert.ok(empty.reward <= 0, "an empty subgraph must not pay for a diagnosis");
});

test("substantive-work predicates reject degenerate results", () => {
  assert.equal(traceWasSubstantive({ paths: [{}] }), true);
  assert.equal(traceWasSubstantive({ paths: [] }), false);
  assert.equal(traceWasSubstantive({}), false);

  assert.equal(explanationWasSubstantive({ present: true, subgraph: { edges: [{}] } }), true);
  assert.equal(explanationWasSubstantive({ present: true, subgraph: { edges: [] } }), false);
  assert.equal(explanationWasSubstantive({ present: false, subgraph: { edges: [{}] } }), false);
});
