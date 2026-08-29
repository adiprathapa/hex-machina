import assert from "node:assert/strict";
import test from "node:test";

import { serializeSpellGraph, validateSpellGraph } from "../src/domain/spell.ts";
import { AGENT_GYM_MAX_SCORE, createAgentGymEnvironment } from "../src/eval/agent-gym.ts";
import {
  benchmarkAgentGymFamily,
  collectAgentGymDataset,
  serializeAgentGymDatasetJsonl,
} from "../src/eval/reference-policy.ts";
import {
  AGENT_GYM_SPLIT_SIZES,
  generateAgentGymScenario,
  getAgentGymSplitManifest,
} from "../src/scenarios/agent-gym-family.ts";
import { simulateCast } from "../src/simulator/cast.ts";

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
  const subjectId = inspection.result.nodes.find((node) => node.label === "Summon ducks").id;
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

  assert.equal(first.readiness, "scenario-family-prototype");
  assert.equal(first.familyId, "moonflower-opaque-roles-v1");
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
    { split: "train", count: 32, seedBase: 410000 },
    { split: "validation", count: 8, seedBase: 520000 },
    { split: "test", count: 8, seedBase: 630000 },
  ]);

  const seenSeeds = new Set();
  const seenScenarioIds = new Set();
  for (const [split, count] of Object.entries(AGENT_GYM_SPLIT_SIZES)) {
    for (let index = 0; index < count; index += 1) {
      const first = generateAgentGymScenario(split, index);
      const second = generateAgentGymScenario(split, index);
      assert.equal(serializeSpellGraph(first.graph), serializeSpellGraph(second.graph));
      assert.deepEqual(validateSpellGraph(first.graph), []);
      assert.equal(simulateCast(first.graph).success, false);
      assert.equal(first.graph.nodes.some((node) => node.id === "summon-ducks"), false);
      assert.equal(seenSeeds.has(first.seed), false, `duplicate seed ${first.seed}`);
      assert.equal(seenScenarioIds.has(first.scenarioId), false, `duplicate scenario ${first.scenarioId}`);
      seenSeeds.add(first.seed);
      seenScenarioIds.add(first.scenarioId);
    }
  }
  assert.equal(seenSeeds.size, 48);
  assert.equal(seenScenarioIds.size, 48);
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

test("benchmark runner completes all 48 split episodes", async () => {
  const benchmark = await benchmarkAgentGymFamily();
  assert.equal(benchmark.protocol, "hex-machina-agent-gym-benchmark/v1");
  assert.equal(benchmark.episodeCount, 48);
  assert.equal(benchmark.completedCount, 48);
  assert.equal(benchmark.meanScore, 23);
  assert.deepEqual(benchmark.splitScores, { train: 23, validation: 23, test: 23 });
  assert.equal(benchmark.episodes.every((episode) => episode.steps === 9), true);
});

test("dataset exporter emits replay-complete JSONL for a requested split", async () => {
  const episodes = await collectAgentGymDataset("test");
  const lines = serializeAgentGymDatasetJsonl(episodes).trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 8);
  assert.equal(lines.every((line) => line.schema === "hex-machina-agent-gym-episode/v1"), true);
  assert.equal(lines.every((line) => line.split === "test" && line.score === 23), true);
  assert.equal(lines.every((line) => line.terminationReason === "goal-verified"), true);
  assert.equal(lines.every((line) => line.transitions.length === 9), true);
  assert.equal(lines.every((line) => line.transitions.every((transition) => (
    transition.observationBefore &&
    transition.observationAfter &&
    /^fnv1a32:[a-f0-9]{8}$/.test(transition.stateKeyBefore) &&
    /^fnv1a32:[a-f0-9]{8}$/.test(transition.stateKeyAfter)
  ))), true);
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
  const recorded = inspection.episode.trajectory[0];
  assert.deepEqual(recorded.observationBefore, reset.observation);
  assert.deepEqual(recorded.observationAfter, inspection.observation);
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
