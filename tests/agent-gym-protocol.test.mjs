import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_GYM_JSONL_PROTOCOL,
  createAgentGymJsonlBridge,
} from "../src/eval/jsonl-rollout.ts";

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
  assert.equal(description.payload.familySplitSizes["resonant-feedback-roles-v1"].test, 4);
  assert.equal(description.payload.actionSpace.length, 7);

  const reset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: 2,
    op: "reset",
    split: "test",
    index: 5,
  })));
  assert.equal(reset.ok, true);
  assert.equal(reset.payload.info.scenarioId, "moonflower-test-05");

  const resonanceReset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: "resonance",
    op: "reset",
    family: "resonant-feedback-roles-v1",
    split: "test",
    index: 3,
  })));
  assert.equal(resonanceReset.ok, true);
  assert.equal(resonanceReset.payload.info.scenarioId, "resonance-test-03");
  assert.equal(resonanceReset.payload.episode.familyId, "resonant-feedback-roles-v1");

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
    }))
`;
  const result = await run("python3", ["-c", script]);
  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt, {
    tools: 7,
    scenario: "moonflower-validation-03",
    graph: "spell-moonflower-validation-03",
    reward: 1,
    terminated: false,
    truncated: false,
    step: 0,
    resultNodes: 12,
    snapshotSteps: 1,
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
            "moonflower-opaque-roles-v1",
            "resonant-feedback-roles-v1",
            "resonant-feedback-roles-v1",
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
    "moonflower-train-00",
    "moonflower-train-01",
    "moonflower-train-02",
  ]);
  assert.deepEqual(receipt.graphIds, [
    "spell-moonflower-train-00",
    "spell-moonflower-train-01",
    "spell-moonflower-train-02",
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
    "moonflower-opaque-roles-v1",
    "resonant-feedback-roles-v1",
    "resonant-feedback-roles-v1",
  ]);
  assert.deepEqual(receipt.mixedScenarios, [
    "moonflower-test-00",
    "resonance-test-00",
    "resonance-test-01",
  ]);
});
