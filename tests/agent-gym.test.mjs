import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_GYM_MAX_SCORE, createAgentGymEnvironment } from "../src/eval/agent-gym.ts";

async function runReferenceEpisode() {
  const gym = createAgentGymEnvironment();
  gym.reset();
  await gym.step({ tool: "inspect_spell" });
  await gym.step({ tool: "simulate_cast" });
  await gym.step({ tool: "trace_effect", input: { effectId: "flooded-observatory" } });
  await gym.step({ tool: "explain_side_effect", input: { sideEffectId: "flooded-observatory" } });
  await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: "summon-ducks", reason: "The ducks are funny. They stay." },
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

  assert.equal(first.readiness, "single-scenario-prototype");
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

