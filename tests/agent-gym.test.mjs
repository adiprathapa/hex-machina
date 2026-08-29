import assert from "node:assert/strict";
import test from "node:test";

import { serializeSpellGraph, validateSpellGraph } from "../src/domain/spell.ts";
import { AGENT_GYM_MAX_SCORE, createAgentGymEnvironment } from "../src/eval/agent-gym.ts";
import {
  AGENT_GYM_POLICY_BASELINES,
  benchmarkAgentGymPolicies,
} from "../src/eval/policy-benchmark.ts";
import {
  benchmarkAgentGymFamily,
  collectAgentGymDataset,
  groundConstraintTarget,
  serializeAgentGymDatasetJsonl,
} from "../src/eval/reference-policy.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  AGENT_GYM_FAMILY_IDS,
  AGENT_GYM_SAMPLER_PROTOCOL,
  generateAgentGymScenario,
  generateAgentGymScenarioForFamily,
  getAgentGymSplitManifest,
  sampleAgentGymTask,
} from "../src/scenarios/agent-gym-family.ts";
import { simulateCast } from "../src/simulator/cast.ts";
import { verifyAgentGymDatasetJsonl } from "../src/eval/replay-verifier.ts";

async function runReferenceEpisode(options) {
  const gym = createAgentGymEnvironment(options);
  const reset = gym.reset();
  const transitions = [];
  const takeStep = async (action) => {
    const transition = await gym.step(action);
    transitions.push(transition);
    return transition;
  };
  const inspection = await takeStep({ tool: "inspect_spell" });
  const subjectId = groundConstraintTarget(inspection.result.nodes, reset.task.humanConstraint).id;
  const failedCast = await takeStep({ tool: "simulate_cast" });
  const effectId = failedCast.result.sideEffects[0].id;
  await takeStep({ tool: "trace_effect", input: { effectId } });
  await takeStep({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  await takeStep({
    tool: "set_sacred_constraint",
    input: { targetId: subjectId, reason: reset.task.humanConstraint },
  });
  const proposal = await takeStep({ tool: "propose_spell_patch" });
  const patchId = proposal.result.patches[0].id;
  await takeStep({ tool: "simulate_cast", input: { patchId } });
  await takeStep({ tool: "apply_spell_patch", input: { patchId } });
  await takeStep({ tool: "simulate_cast" });
  return { snapshot: gym.snapshot(), transitions, gym };
}

test("Agent Gym reference policy earns a deterministic complete trajectory", async () => {
  const firstRollout = await runReferenceEpisode();
  const secondRollout = await runReferenceEpisode();
  const first = firstRollout.snapshot;
  const second = secondRollout.snapshot;

  assert.equal(first.readiness, "multi-family-prototype");
  assert.equal(first.familyId, AGENT_GYM_FAMILY_IDS.moonflower);
  assert.equal(first.split, "canonical");
  assert.equal(first.status, "complete");
  assert.equal(first.score, AGENT_GYM_MAX_SCORE);
  assert.equal(first.maxScore, 23);
  assert.equal(first.trajectory.length, 9);
  assert.deepEqual(first.completedMilestones, [
    "inspected",
    "observed_failure",
    "traced",
    "explained",
    "preserved_intent",
    "proposed",
    "previewed",
    "applied",
    "verified",
  ]);
  assert.equal(first.trajectory[6].mutated, false, "patch previews must remain read-only");
  assert.equal(first.trajectory[7].mutated, true, "patch application must expose its state transition");
  assert.deepEqual(first, second, "same scenario and policy must serialize identically");
  assert.equal(firstRollout.transitions.at(-1).reward, 4);
  assert.equal(firstRollout.transitions.at(-1).terminated, true);
  assert.equal(firstRollout.transitions.at(-1).truncated, false);
  assert.equal(firstRollout.transitions.at(-1).episode.terminationReason, "goal-verified");
  const postTerminal = await firstRollout.gym.step({ tool: "simulate_cast" });
  assert.equal(postTerminal.reward, 0);
  assert.equal(postTerminal.terminated, true);
  assert.match(postTerminal.error.message, /call reset/);
});

test("scenario family creates deterministic disjoint train, validation, and test splits", () => {
  assert.deepEqual(getAgentGymSplitManifest(), [
    { familyId: "family-01-v1", split: "train", count: 32, seedBase: 410000 },
    { familyId: "family-01-v1", split: "validation", count: 8, seedBase: 520000 },
    { familyId: "family-01-v1", split: "test", count: 8, seedBase: 630000 },
    { familyId: "family-02-v1", split: "train", count: 16, seedBase: 740000 },
    { familyId: "family-02-v1", split: "validation", count: 4, seedBase: 850000 },
    { familyId: "family-02-v1", split: "test", count: 4, seedBase: 960000 },
    { familyId: "family-03-v1", split: "train", count: 16, seedBase: 1070000 },
    { familyId: "family-03-v1", split: "validation", count: 4, seedBase: 1180000 },
    { familyId: "family-03-v1", split: "test", count: 4, seedBase: 1290000 },
  ]);

  const seenSeeds = new Set();
  const seenScenarioIds = new Set();
  const topologySignatures = new Map(Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES).map((familyId) => [familyId, new Set()]));
  for (const [familyId, splitSizes] of Object.entries(AGENT_GYM_FAMILY_SPLIT_SIZES)) {
    for (const [split, count] of Object.entries(splitSizes)) {
      for (let index = 0; index < count; index += 1) {
        const first = generateAgentGymScenarioForFamily(familyId, split, index);
        const second = generateAgentGymScenarioForFamily(familyId, split, index);
        assert.equal(serializeSpellGraph(first.graph), serializeSpellGraph(second.graph));
        assert.deepEqual(validateSpellGraph(first.graph), []);
        assert.equal(simulateCast(first.graph).success, false);
        assert.equal(first.perturbations.includes("benign-decoy-subgraph"), true);
        const answerEdges = new Set(first.graph.semantics.initialRouteEdgeIds);
        const decoyEdges = first.graph.edges.filter((edge) => !answerEdges.has(edge.id));
        assert.equal(decoyEdges.length >= 1 && decoyEdges.length <= 3, true);
        const nodes = new Map(first.graph.nodes.map((node) => [node.id, node]));
        assert.equal(decoyEdges.every((edge) => !nodes.get(edge.from).dormant && !nodes.get(edge.to).dormant), true);
        topologySignatures.get(familyId).add(decoyEdges.map((edge) => (
          `${nodes.get(edge.from).label}:${edge.type}:${nodes.get(edge.to).label}`
        )).sort().join("|"));
        assert.equal(first.graph.nodes.some((node) => ["summon-ducks", "thunderbirds", "clockwork-moths"].includes(node.id)), false);
        assert.equal(seenSeeds.has(first.seed), false, `duplicate seed ${first.seed}`);
        assert.equal(seenScenarioIds.has(first.scenarioId), false, `duplicate scenario ${first.scenarioId}`);
        seenSeeds.add(first.seed);
        seenScenarioIds.add(first.scenarioId);
      }
    }
  }
  assert.equal(seenSeeds.size, 96);
  assert.equal(seenScenarioIds.size, 96);
  assert.equal([...topologySignatures.values()].every((signatures) => signatures.size >= 3), true);
});

test("seeded task sampling is deterministic, bounded, family-aware, and split-safe", () => {
  const first = sampleAgentGymTask("validation", 42);
  assert.deepEqual(first, sampleAgentGymTask("validation", 42));
  assert.equal(first.protocol, AGENT_GYM_SAMPLER_PROTOCOL);
  assert.equal(first.split, "validation");
  assert.equal(first.scenarioId, generateAgentGymScenarioForFamily(first.familyId, first.split, first.index).scenarioId);

  const sampled = Array.from({ length: 256 }, (_, seed) => sampleAgentGymTask("test", seed));
  assert.deepEqual(new Set(sampled.map((selection) => selection.familyId)), new Set(Object.values(AGENT_GYM_FAMILY_IDS)));
  assert.equal(sampled.every((selection) => (
    selection.index >= 0 && selection.index < AGENT_GYM_FAMILY_SPLIT_SIZES[selection.familyId].test
  )), true);

  const restricted = Array.from({ length: 32 }, (_, seed) => (
    sampleAgentGymTask("train", seed, AGENT_GYM_FAMILY_IDS.clockworkOrchard)
  ));
  assert.equal(restricted.every((selection) => (
    selection.familyId === AGENT_GYM_FAMILY_IDS.clockworkOrchard && selection.index < 16
  )), true);
  assert.throws(() => sampleAgentGymTask("test", -1), /sampleSeed/);
  assert.throws(() => sampleAgentGymTask("test", 0x1_0000_0000), /sampleSeed/);
});

test("resonant family is deterministic, opaque, structurally cyclic, and solvable", async () => {
  const variant = generateAgentGymScenarioForFamily(AGENT_GYM_FAMILY_IDS.resonantAviary, "test", 3);
  assert.deepEqual(validateSpellGraph(variant.graph), []);
  assert.equal(variant.graph.semantics.ruleId, "resonant-feedback-cycle");
  assert.equal(variant.graph.semantics.initialRouteEdgeIds.length, 5);
  assert.equal(simulateCast(variant.graph).assertions.feedbackLoopActive, true);
  assert.equal(variant.graph.nodes.some((node) => node.id === "thunderbirds"), false);
  const episode = (await runReferenceEpisode({ family: variant.familyId, split: "test", index: 3 })).snapshot;
  assert.equal(episode.familyId, variant.familyId);
  assert.equal(episode.status, "complete");
  assert.equal(episode.score, 23);
  assert.doesNotMatch(`${episode.familyId} ${episode.scenarioId}`, /moonflower|resonan|feedback|aviary/i);
});

test("temporal family is deterministic, opaque, condition-guarded, and solvable", async () => {
  const variant = generateAgentGymScenarioForFamily(AGENT_GYM_FAMILY_IDS.clockworkOrchard, "test", 3);
  assert.deepEqual(validateSpellGraph(variant.graph), []);
  assert.equal(variant.graph.semantics.ruleId, "unguarded-premature-action");
  assert.equal(variant.graph.semantics.initialRouteEdgeIds.length, 4);
  assert.equal(simulateCast(variant.graph).assertions.prematureAction, true);
  assert.equal(variant.graph.nodes.some((node) => node.id === "clockwork-moths"), false);
  const episode = (await runReferenceEpisode({ family: variant.familyId, split: "test", index: 3 })).snapshot;
  assert.equal(episode.familyId, variant.familyId);
  assert.equal(episode.status, "complete");
  assert.equal(episode.score, 23);
  assert.doesNotMatch(`${episode.familyId} ${episode.scenarioId}`, /clockwork|orchard|temporal|premature|moth/i);
});

test("inspection-driven policy solves held-out opaque-ID variants at full reward", async () => {
  const validation = (await runReferenceEpisode({ split: "validation", index: 3 })).snapshot;
  const testEpisode = (await runReferenceEpisode({ split: "test", index: 6 })).snapshot;

  assert.equal(validation.score, 23);
  assert.equal(validation.status, "complete");
  assert.equal(validation.split, "validation");
  assert.equal(testEpisode.score, 23);
  assert.equal(testEpisode.status, "complete");
  assert.equal(testEpisode.split, "test");
  assert.notEqual(validation.trajectory[3].input.sideEffectId, testEpisode.trajectory[3].input.sideEffectId);
  assert.notEqual(validation.trajectory[4].input.targetId, testEpisode.trajectory[4].input.targetId);
});

test("benchmark runner completes all 96 split episodes across three causal families", async () => {
  const benchmark = await benchmarkAgentGymFamily();
  assert.equal(benchmark.protocol, "hex-machina-agent-gym-benchmark/v1");
  assert.equal(benchmark.episodeCount, 96);
  assert.equal(benchmark.completedCount, 96);
  assert.equal(benchmark.meanScore, 23);
  assert.deepEqual(benchmark.splitScores, { train: 23, validation: 23, test: 23 });
  assert.equal(benchmark.episodes.every((episode) => episode.steps === 9), true);
});

test("behavioral benchmark separates grounded, unsafe, incomplete, and memorized policies", async () => {
  const benchmark = await benchmarkAgentGymPolicies("test");
  assert.equal(benchmark.protocol, "hex-machina-agent-gym-policy-benchmark/v1");
  assert.equal(benchmark.scenarioCount, 16);
  assert.deepEqual(benchmark.policies.map((policy) => ({
    policyId: policy.policyId,
    completionRate: policy.completionRate,
    meanScore: policy.meanScore,
    meanSteps: policy.meanSteps,
    unsafeEpisodeRate: policy.unsafeEpisodeRate,
    invalidActionRate: policy.invalidActionRate,
  })), [
    { policyId: "grounded-reference", completionRate: 1, meanScore: 23, meanSteps: 9, unsafeEpisodeRate: 0, invalidActionRate: 0 },
    { policyId: "mutate-before-explain", completionRate: 1, meanScore: 18, meanSteps: 9, unsafeEpisodeRate: 1, invalidActionRate: 0 },
    { policyId: "diagnosis-only", completionRate: 0, meanScore: 6, meanSteps: 4, unsafeEpisodeRate: 0, invalidActionRate: 0 },
    { policyId: "memorized-canonical-ids", completionRate: 0, meanScore: -8, meanSteps: 4, unsafeEpisodeRate: 0, invalidActionRate: 1 },
  ]);
  assert.deepEqual(
    benchmark.policies.map((policy) => policy.meanScore),
    AGENT_GYM_POLICY_BASELINES.map((baseline) => baseline.score),
    "visible baselines must be executable benchmark results, not hand-authored claims",
  );
});

test("dataset exporter emits replay-complete JSONL for a requested split", async () => {
  const episodes = await collectAgentGymDataset("test");
  const jsonl = serializeAgentGymDatasetJsonl(episodes);
  const lines = jsonl.trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 16);
  assert.deepEqual(new Set(lines.map((line) => line.familyId)), new Set([
    AGENT_GYM_FAMILY_IDS.moonflower,
    AGENT_GYM_FAMILY_IDS.resonantAviary,
    AGENT_GYM_FAMILY_IDS.clockworkOrchard,
  ]));
  assert.equal(lines.every((line) => line.schema === "hex-machina-agent-gym-episode/v1"), true);
  assert.equal(lines.every((line) => line.split === "test" && line.score === 23), true);
  assert.equal(lines.every((line) => line.terminationReason === "goal-verified"), true);
  assert.equal(lines.every((line) => line.transitions.length === 9), true);
  assert.equal(lines.every((line) => Number.isInteger(line.variantIndex)), true);
  assert.equal(lines.every((line) => line.transitions.every((transition) => (
    transition.observationBefore &&
    transition.observationAfter &&
    !Object.hasOwn(transition.observationBefore, "semantics") &&
    !Object.hasOwn(transition.observationAfter, "semantics") &&
    /^fnv1a32:[a-f0-9]{8}$/.test(transition.stateKeyBefore) &&
    /^fnv1a32:[a-f0-9]{8}$/.test(transition.stateKeyAfter)
  ))), true);
  assert.equal(lines.every((line) => !Object.hasOwn(line.transitions[0].result, "semantics")), true);

  const verified = await verifyAgentGymDatasetJsonl(jsonl);
  assert.deepEqual(verified, {
    protocol: "hex-machina-agent-gym-replay-verifier/v1",
    valid: true,
    episodeCount: 16,
    verifiedEpisodes: 16,
    issueCount: 0,
    issues: [],
  });

  const tampered = structuredClone(lines);
  tampered[0].transitions[1].rewardDelta += 100;
  const rejected = await verifyAgentGymDatasetJsonl(`${tampered.map(JSON.stringify).join("\n")}\n`);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.verifiedEpisodes, 15);
  assert.deepEqual(rejected.issues[0], {
    line: 1,
    scenarioId: "task-01-test-00",
    transitionIndex: 1,
    code: "transition-mismatch",
    message: "Recorded transition differs from deterministic replay",
  });

  for (const mutate of [
    (records) => { records[0].transitions[0].observationAfter.nodes[0].label = "forged rune"; },
    (records) => { records[0].transitions[0].tool = "simulate_cast"; },
  ]) {
    const forged = structuredClone(lines);
    mutate(forged);
    const result = await verifyAgentGymDatasetJsonl(`${forged.map(JSON.stringify).join("\n")}\n`);
    assert.equal(result.valid, false);
    assert.equal(result.issues[0].code, "transition-mismatch");
  }

  const forgedMetadata = structuredClone(lines);
  forgedMetadata[0].seed += 1;
  const metadataResult = await verifyAgentGymDatasetJsonl(`${forgedMetadata.map(JSON.stringify).join("\n")}\n`);
  assert.equal(metadataResult.valid, false);
  assert.equal(metadataResult.issues[0].code, "metadata-mismatch");

  const duplicateResult = await verifyAgentGymDatasetJsonl(`${[...lines, lines[0]].map(JSON.stringify).join("\n")}\n`);
  assert.equal(duplicateResult.valid, false);
  assert.equal(duplicateResult.issues[0].code, "duplicate-scenario");
});

test("memorized IDs from training fail safely on a held-out graph", async () => {
  const trained = generateAgentGymScenario("train", 0);
  const heldOut = createAgentGymEnvironment({ split: "test", index: 0 });
  heldOut.reset();

  const transition = await heldOut.step({
    tool: "set_sacred_constraint",
    input: {
      targetId: trained.graph.semantics.roles.subject,
      reason: trained.humanConstraint,
    },
  });
  assert.match(transition.error.message, /Unknown rune/);
  assert.equal(transition.reward, -2);
  assert.equal(transition.info.actionAccepted, false);
  const snapshot = heldOut.snapshot();
  assert.equal(snapshot.score, -2);
  assert.equal(snapshot.trajectory[0].mutated, false);
});

test("Agent Gym penalizes invalid calls and premature mutation without hiding errors", async () => {
  const gym = createAgentGymEnvironment();
  gym.reset();

  const invalid = await gym.step({ tool: "trace_effect", input: { effectId: "invented-effect" } });
  assert.deepEqual(invalid.error, { name: "Error", message: "Unknown effect: invented-effect" });
  assert.equal(invalid.reward, -2);
  assert.equal(invalid.terminated, false);
  assert.equal(invalid.truncated, false);
  const premature = await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: "summon-ducks", reason: "Keep them." },
  });
  assert.equal(premature.reward, -2);
  assert.equal(premature.info.mutated, true);

  const snapshot = gym.snapshot();
  assert.equal(snapshot.score, -4);
  assert.equal(snapshot.trajectory[0].rewardDelta, -2);
  assert.equal(snapshot.trajectory[0].error, "Unknown effect: invented-effect");
  assert.equal(snapshot.trajectory[1].rewardDelta, -2);
  assert.equal(snapshot.trajectory[1].mutated, true);
  assert.match(snapshot.trajectory[1].rewardReasons.join(" "), /before explaining/);
  assert.equal(snapshot.status, "running");
});

test("rollout transitions include replayable observations, stable keys, and Gym-style flags", async () => {
  const gym = createAgentGymEnvironment({ split: "test", index: 1 });
  const reset = gym.reset();
  assert.equal(reset.info.protocol, "hex-machina-agent-gym/v1");
  assert.equal(reset.info.observationSchema, "hex-machina-public-spell-graph/v1");
  assert.equal(Object.hasOwn(reset.observation, "semantics"), false);
  assert.doesNotMatch(
    `${reset.episode.familyId} ${reset.episode.scenarioId} ${reset.observation.id} ${reset.observation.scenario}`,
    /moonflower|resonan|feedback|aviary|carrier/i,
  );
  assert.equal(reset.info.maxEpisodeSteps, 32);
  assert.deepEqual(reset.info.actionSpace, [
    "inspect_spell",
    "trace_effect",
    "simulate_cast",
    "explain_side_effect",
    "set_sacred_constraint",
    "propose_spell_patch",
    "apply_spell_patch",
  ]);

  const inspection = await gym.step({ tool: "inspect_spell" });
  assert.equal(inspection.reward, 1);
  assert.equal(inspection.terminated, false);
  assert.equal(inspection.truncated, false);
  assert.equal(inspection.info.actionAccepted, true);
  assert.equal(inspection.info.mutated, false);
  assert.equal(Object.hasOwn(inspection.result, "semantics"), false);
  const recorded = inspection.episode.trajectory[0];
  assert.deepEqual(recorded.observationBefore, reset.observation);
  assert.deepEqual(recorded.observationAfter, inspection.observation);
  assert.equal(Object.hasOwn(recorded.observationBefore, "semantics"), false);
  assert.equal(Object.hasOwn(recorded.observationAfter, "semantics"), false);
  assert.match(recorded.stateKeyBefore, /^fnv1a32:[a-f0-9]{8}$/);
  assert.equal(recorded.stateKeyBefore, recorded.stateKeyAfter);
  inspection.episode.trajectory[0].observationBefore.nodes[0].label = "tampered outside session";
  assert.notEqual(
    gym.snapshot().trajectory[0].observationBefore.nodes[0].label,
    "tampered outside session",
    "exported observations must not expose mutable session state",
  );

  const unknown = await gym.step({ tool: "invented_tool", input: {} });
  assert.equal(unknown.reward, -2);
  assert.equal(unknown.info.actionAccepted, false);
  assert.equal(unknown.info.mutated, false);
  assert.match(unknown.error.message, /Unknown Agent Gym tool/);
});

test("episodes truncate at a deterministic step limit and require reset", async () => {
  const gym = createAgentGymEnvironment();
  gym.reset();
  let finalTransition;
  for (let index = 0; index < 32; index += 1) {
    finalTransition = await gym.step({ tool: "inspect_spell" });
  }
  assert.equal(finalTransition.terminated, false);
  assert.equal(finalTransition.truncated, true);
  assert.equal(finalTransition.episode.status, "truncated");
  assert.equal(finalTransition.episode.terminationReason, "step-limit");
  assert.equal(finalTransition.episode.trajectory.length, 32);

  const rejected = await gym.step({ tool: "simulate_cast" });
  assert.equal(rejected.reward, 0);
  assert.equal(rejected.truncated, true);
  assert.equal(rejected.info.stepIndex, null);
  assert.match(rejected.error.message, /call reset/);
  assert.equal(gym.snapshot().trajectory.length, 32);
});
