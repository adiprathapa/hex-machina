import assert from "node:assert/strict";
import test from "node:test";

import { createAgentGymEnvironment } from "../src/eval/agent-gym.ts";
import { groundConstraintTarget } from "../src/eval/reference-policy.ts";

test("state keys are 64-bit, so a rollout cannot collide its own state space", async () => {
  const gym = createAgentGymEnvironment({ split: "test", index: 0 });
  gym.reset();
  await gym.step({ tool: "inspect_spell" });
  const [step] = gym.snapshot().trajectory;

  for (const key of [
    step.stateKeyBefore, step.stateKeyAfter,
    step.episodeStateKeyBefore, step.episodeStateKeyAfter,
  ]) {
    assert.match(key, /^fnv1a64:[a-f0-9]{16}$/, `${key} is not a 64-bit key`);
  }
});

test("distinct constraint text produces distinct keys", async () => {
  // The reason field is free text that lands in the serialized graph, and is
  // where a collision search found two colliding states under the old 32-bit
  // key. Distinct text must still produce distinct keys.
  const keys = new Set();
  for (const reason of ["The ducks are funny. They stay.", "Keep the ducks.", "Ducks stay!"]) {
    const gym = createAgentGymEnvironment({ split: "test", index: 0 });
    const reset = gym.reset();
    const inspection = await gym.step({ tool: "inspect_spell" });
    const subject = groundConstraintTarget(inspection.result.nodes, reset.task.humanConstraint);
    await gym.step({ tool: "simulate_cast" });
    const effectId = gym.snapshot().trajectory[1].result.sideEffects[0].id;
    await gym.step({ tool: "trace_effect", input: { effectId } });
    await gym.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
    await gym.step({ tool: "set_sacred_constraint", input: { targetId: subject.id, reason } });
    keys.add(gym.snapshot().trajectory.at(-1).stateKeyAfter);
    assert.ok(reset.task.humanConstraint.length > 0);
  }
  assert.equal(keys.size, 3, "three distinct constraint texts must give three distinct keys");
});

test("the episode key separates states the graph key cannot", async () => {
  // propose_spell_patch issues the apply capability without touching the graph,
  // so the graph key alone is not a state: the same key precedes a rejected
  // apply and an accepted one.
  const withoutProposal = createAgentGymEnvironment({ split: "test", index: 0 });
  withoutProposal.reset();
  const rejected = await withoutProposal.step({
    tool: "apply_spell_patch", input: { patchId: "patch-umbrella-v1" },
  });
  const rejectedStep = withoutProposal.snapshot().trajectory.at(-1);

  const withProposal = createAgentGymEnvironment({ split: "test", index: 0 });
  withProposal.reset();
  await withProposal.step({ tool: "propose_spell_patch" });
  const accepted = await withProposal.step({
    tool: "apply_spell_patch", input: { patchId: "patch-umbrella-v1" },
  });
  const acceptedStep = withProposal.snapshot().trajectory.at(-1);

  assert.ok(rejected.error !== undefined, "an unissued patch must be refused");
  assert.ok(accepted.error === undefined, "an issued patch must be accepted");
  assert.equal(
    rejectedStep.stateKeyBefore,
    acceptedStep.stateKeyBefore,
    "the graph is identical in both cases, so the graph key must match",
  );
  assert.notEqual(
    rejectedStep.episodeStateKeyBefore,
    acceptedStep.episodeStateKeyBefore,
    "the episode key must distinguish states that decide the next transition",
  );
});
