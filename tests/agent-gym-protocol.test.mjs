import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_GYM_JSONL_PROTOCOL,
  createAgentGymJsonlBridge,
} from "../src/eval/jsonl-rollout.ts";
import { AGENT_GYM_FAMILY_IDS } from "../src/scenarios/agent-gym-family.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("JSONL rollout bridge is strict, recoverable, and stateful", async () => {
  const bridge = createAgentGymJsonlBridge();
  const malformed = JSON.parse(await bridge.handleLine("not json"));
  assert.equal(malformed.protocol, AGENT_GYM_JSONL_PROTOCOL);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "invalid-request");

  const premature = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: "early",
    op: "step",
    action: { tool: "inspect_spell" },
  })));
  assert.equal(premature.ok, false);
  assert.match(premature.error.message, /reset/);

  const description = JSON.parse(await bridge.handleLine('{"id":1,"op":"describe"}'));
  assert.equal(description.ok, true, "a bad request must not poison the bridge");
  assert.equal(description.payload.maxEpisodeSteps, 32);
  assert.equal(description.payload.splitSizes.test, 8);
  assert.equal(description.payload.familySplitSizes[AGENT_GYM_FAMILY_IDS.resonantAviary].test, 4);
  assert.equal(
    Object.keys(description.payload.familySplitSizes).every((familyId) => !/moonflower|resonan|feedback|aviary/i.test(familyId)),
    true,
  );
  assert.equal(description.payload.observationSpace.schema, "hex-machina-public-spell-graph/v1");
  assert.match(description.payload.observationSpace.excludes.join(" "), /role assignments/);
  assert.match(description.payload.observationSpace.excludes.join(" "), /pre-cast diagnostic assertions/);
  assert.equal(description.payload.actionSpace.length, 7);

  const reset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: 2,
    op: "reset",
    split: "test",
    index: 5,
  })));
  assert.equal(reset.ok, true);
  assert.equal(reset.payload.info.scenarioId, "task-01-test-05");

  const resonanceReset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: "resonance",
    op: "reset",
    family: AGENT_GYM_FAMILY_IDS.resonantAviary,
    split: "test",
    index: 3,
  })));
  assert.equal(resonanceReset.ok, true);
  assert.equal(resonanceReset.payload.info.scenarioId, "task-02-test-03");
  assert.equal(resonanceReset.payload.episode.familyId, AGENT_GYM_FAMILY_IDS.resonantAviary);
  assert.doesNotMatch(
    `${resonanceReset.payload.episode.familyId} ${resonanceReset.payload.episode.scenarioId} ${resonanceReset.payload.observation.scenario}`,
    /moonflower|resonan|feedback|aviary|carrier/i,
  );

  const step = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: 3,
    op: "step",
    action: { tool: "inspect_spell" },
  })));
  assert.equal(step.ok, true);
  assert.equal(step.payload.reward, 1);
  assert.equal(step.payload.info.stepIndex, 0);
  assert.equal(step.payload.episode.trajectory.length, 1);

  const unknownTool = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: 4,
    op: "step",
    action: { tool: "invented_tool" },
  })));
  assert.equal(unknownTool.ok, true, "agent mistakes are environment transitions, not transport failures");
  assert.equal(unknownTool.payload.reward, -2);
  assert.equal(unknownTool.payload.info.actionAccepted, false);
});

test("dependency-free Python adapter drives a held-out production rollout", async () => {
  const script = String.raw`
import json
from adapters.hex_machina_env import HexMachinaEnv

with HexMachinaEnv() as env:
    description = env.describe()
    observation, reset_info = env.reset("validation", 3)
    observation, reward, terminated, truncated, info = env.step({"tool": "inspect_spell"})
    print(json.dumps({
        "tools": len(description["actionSpace"]),
        "scenario": reset_info["scenarioId"],
        "graph": observation["id"],
        "reward": reward,
        "terminated": terminated,
        "truncated": truncated,
        "step": info["stepIndex"],
        "resultNodes": len(info["result"]["nodes"]),
        "snapshotSteps": len(env.snapshot()["trajectory"]),
        "semanticsExposed": "semantics" in observation,
    }))
`;
  const result = await run("python3", ["-c", script]);
  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt, {
    tools: 7,
    scenario: "task-01-validation-03",
    graph: "spell-task-01-validation-03",
    reward: 1,
    terminated: false,
    truncated: false,
    step: 0,
    resultNodes: 12,
    snapshotSteps: 1,
    semanticsExposed: false,
  });
});

test("Python vector adapter preserves deterministic slot order and state isolation", async () => {
  const script = String.raw`
import json
from adapters import HexMachinaVectorEnv

with HexMachinaVectorEnv(3) as envs:
    validationErrors = []
    try:
        envs.step([{"tool": "inspect_spell"}])
    except ValueError as error:
        validationErrors.append(str(error))
    try:
        envs.reset(indices=[0, 1, 2])
    except ValueError as error:
        validationErrors.append(str(error))
    observations, reset_info = envs.reset("train", [0, 1, 2])
    observations, rewards, terminated, truncated, infos = envs.step([
        {"tool": "inspect_spell"},
        {"tool": "inspect_spell"},
        {"tool": "inspect_spell"},
    ])
    _, second_rewards, _, _, second_infos = envs.step([
        {"tool": "simulate_cast"},
        {"tool": "invented_tool"},
        {"tool": "inspect_spell"},
    ])
    snapshots = envs.snapshots()
    mixed_observations, mixed_info = envs.reset(
        "test",
        [0, 0, 1],
        families=[
            "family-01-v1",
            "family-02-v1",
            "family-02-v1",
        ],
    )
    print(json.dumps({
        "scenarioIds": [info["scenarioId"] for info in reset_info],
        "graphIds": [observation["id"] for observation in observations],
        "firstRewards": rewards,
        "firstSteps": [info["stepIndex"] for info in infos],
        "secondRewards": second_rewards,
        "secondAccepted": [info["actionAccepted"] for info in second_infos],
        "trajectoryLengths": [len(snapshot["trajectory"]) for snapshot in snapshots],
        "stateKeys": [snapshot["trajectory"][0]["stateKeyBefore"] for snapshot in snapshots],
        "validationErrors": validationErrors,
        "mixedFamilies": [info["episode"]["familyId"] for info in mixed_info],
        "mixedScenarios": [info["scenarioId"] for info in mixed_info],
    }))
`;
  const result = await run("python3", ["-c", script]);
  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.scenarioIds, [
    "task-01-train-00",
    "task-01-train-01",
    "task-01-train-02",
  ]);
  assert.deepEqual(receipt.graphIds, [
    "spell-task-01-train-00",
    "spell-task-01-train-01",
    "spell-task-01-train-02",
  ]);
  assert.deepEqual(receipt.firstRewards, [1, 1, 1]);
  assert.deepEqual(receipt.firstSteps, [0, 0, 0]);
  assert.deepEqual(receipt.secondRewards, [1, -2, -0.25]);
  assert.deepEqual(receipt.secondAccepted, [true, false, true]);
  assert.deepEqual(receipt.trajectoryLengths, [2, 2, 2]);
  assert.equal(new Set(receipt.stateKeys).size, 3, "opaque split slots must not share observations");
  assert.deepEqual(receipt.validationErrors, [
    "actions must contain exactly 3 items; received 1",
    "split is required when indices are provided",
  ]);
  assert.deepEqual(receipt.mixedFamilies, [
    "family-01-v1",
    "family-02-v1",
    "family-02-v1",
  ]);
  assert.deepEqual(receipt.mixedScenarios, [
    "task-01-test-00",
    "task-02-test-00",
    "task-02-test-01",
  ]);
});
