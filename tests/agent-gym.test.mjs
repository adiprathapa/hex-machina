import assert from "node:assert/strict";
import test from "node:test";

import { serializeSpellGraph, validateSpellGraph } from "../src/domain/spell.ts";
import { AGENT_GYM_MAX_SCORE, createAgentGymEnvironment } from "../src/eval/agent-gym.ts";
import { benchmarkAgentGymFamily } from "../src/eval/reference-policy.ts";
import {
  AGENT_GYM_SPLIT_SIZES,
  generateAgentGymScenario,
  getAgentGymSplitManifest,
} from "../src/scenarios/agent-gym-family.ts";
import { simulateCast } from "../src/simulator/cast.ts";

async function runReferenceEpisode(options) {
  const gym = createAgentGymEnvironment(options);
  const reset = gym.reset();
  const inspection = await gym.step({ tool: "inspect_spell" });
  const subjectId = inspection.result.nodes.find((node) => node.label === "Summon ducks").id;
  const failedCast = await gym.step({ tool: "simulate_cast" });
  const effectId = failedCast.result.sideEffects[0].id;
  await gym.step({ tool: "trace_effect", input: { effectId } });
  await gym.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: subjectId, reason: reset.task.humanConstraint },
  });
  const proposal = await gym.step({ tool: "propose_spell_patch" });
  const patchId = proposal.result.patches[0].id;
  await gym.step({ tool: "simulate_cast", input: { patchId } });
  await gym.step({ tool: "apply_spell_patch", input: { patchId } });
  await gym.step({ tool: "simulate_cast" });
  return gym.snapshot();
}

test("Agent Gym reference policy earns a deterministic complete trajectory", async () => {
  const first = await runReferenceEpisode();
  const second = await runReferenceEpisode();

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
  const validation = await runReferenceEpisode({ split: "validation", index: 3 });
  const testEpisode = await runReferenceEpisode({ split: "test", index: 6 });

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

test("memorized IDs from training fail safely on a held-out graph", async () => {
  const trained = generateAgentGymScenario("train", 0);
  const heldOut = createAgentGymEnvironment({ split: "test", index: 0 });
  heldOut.reset();

  await assert.rejects(
    heldOut.step({
      tool: "set_sacred_constraint",
      input: {
        targetId: trained.graph.semantics.roles.subject,
        reason: trained.humanConstraint,
      },
    }),
    /Unknown rune/,
  );
  const snapshot = heldOut.snapshot();
  assert.equal(snapshot.score, -2);
  assert.equal(snapshot.trajectory[0].mutated, false);
});

test("Agent Gym penalizes invalid calls and premature mutation without hiding errors", async () => {
  const gym = createAgentGymEnvironment();
  gym.reset();

  await assert.rejects(
    gym.step({ tool: "trace_effect", input: { effectId: "invented-effect" } }),
    /Unknown effect/,
  );
  await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: "summon-ducks", reason: "Keep them." },
  });

  const snapshot = gym.snapshot();
  assert.equal(snapshot.score, -4);
  assert.equal(snapshot.trajectory[0].rewardDelta, -2);
  assert.equal(snapshot.trajectory[0].error, "Unknown effect: invented-effect");
  assert.equal(snapshot.trajectory[1].rewardDelta, -2);
  assert.equal(snapshot.trajectory[1].mutated, true);
  assert.match(snapshot.trajectory[1].rewardReasons.join(" "), /before explaining/);
  assert.equal(snapshot.status, "running");
});
