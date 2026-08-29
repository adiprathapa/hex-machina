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
  assert.deepEqual(description.payload.resetSampling, {
    protocol: "hex-machina-agent-gym-sampler/v1",
    algorithm: "xorshift32-uniform-task-v1",
    sampleSeedRange: [0, 4294967295],
    defaultSplit: "train",
    supportsFamilyRestriction: true,
  });
  assert.equal(description.payload.splitSizes.test, 8);
  assert.equal(description.payload.familySplitSizes[AGENT_GYM_FAMILY_IDS.resonantAviary].test, 4);
  assert.equal(description.payload.familySplitSizes[AGENT_GYM_FAMILY_IDS.clockworkOrchard].test, 4);
  assert.equal(
    Object.keys(description.payload.familySplitSizes).every((familyId) => !/moonflower|resonan|feedback|aviary/i.test(familyId)),
    true,
  );
  assert.equal(description.payload.observationSpace.schema, "hex-machina-public-spell-graph/v1");
  assert.match(description.payload.observationSpace.excludes.join(" "), /role assignments/);
  assert.match(description.payload.observationSpace.excludes.join(" "), /pre-cast diagnostic assertions/);
  assert.equal(description.payload.actionSpace.length, 7);
  const manifest = description.payload.actionManifest;
  assert.equal(manifest.protocol, "hex-machina-tool-manifest/v1");
  assert.deepEqual(manifest.actionFormat.properties.tool.enum, description.payload.actionSpace);
  assert.equal(manifest.tools.length, 7);
  assert.deepEqual(manifest.tools.map((tool) => tool.name), description.payload.actionSpace);
  assert.equal(manifest.tools.filter((tool) => tool.annotations.readOnlyHint).length, 5);
  assert.equal(manifest.tools.every((tool) => tool.inputSchema.additionalProperties === false), true);
  const manifestByName = Object.fromEntries(manifest.tools.map((tool) => [tool.name, tool]));
  assert.equal("enum" in manifestByName.inspect_spell.inputSchema.properties.nodeIds.items, false);
  assert.equal("enum" in manifestByName.trace_effect.inputSchema.properties.effectId, false);
  assert.equal("enum" in manifestByName.trace_effect.inputSchema.properties.sourceId, false);
  assert.equal("enum" in manifestByName.set_sacred_constraint.inputSchema.properties.targetId, false);
  assert.equal(
    manifestByName.simulate_cast.inputSchema.properties.patchId.pattern,
    "^patch-[a-z0-9-]{1,96}-v[0-9]+$",
  );
  assert.equal(
    manifestByName.apply_spell_patch.inputSchema.properties.revertToken.pattern,
    "^revert-patch-[a-z0-9-]{1,96}-v[0-9]+-after-v[0-9]+$",
  );
  assert.doesNotMatch(JSON.stringify(manifest), /semantics|role assignments|answer-key/i);

  const reset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: 2,
    op: "reset",
    split: "test",
    index: 5,
  })));
  assert.equal(reset.ok, true);
  assert.equal(reset.payload.info.scenarioId, "task-01-test-05");
  assert.deepEqual(reset.payload.info.actionManifest, manifest);

  const sampledReset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: "sampled",
    op: "reset",
    sampleSeed: 42,
  })));
  const repeatedSample = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: "sampled-again",
    op: "reset",
    sampleSeed: 42,
  })));
  assert.equal(sampledReset.ok, true);
  assert.equal(sampledReset.payload.info.sampledTask.protocol, "hex-machina-agent-gym-sampler/v1");
  assert.equal(sampledReset.payload.info.sampledTask.sampleSeed, 42);
  assert.equal(sampledReset.payload.info.sampledTask.split, "train");
  assert.equal(sampledReset.payload.info.sampledTask.scenarioId, sampledReset.payload.info.scenarioId);
  assert.deepEqual(sampledReset.payload.observation, repeatedSample.payload.observation);
  assert.deepEqual(sampledReset.payload.task, repeatedSample.payload.task);

  for (const request of [
    { id: "ambiguous-sample", op: "reset", split: "test", index: 0, sampleSeed: 1 },
    { id: "invalid-sample", op: "reset", split: "test", sampleSeed: -1 },
  ]) {
    const rejected = JSON.parse(await bridge.handleLine(JSON.stringify(request)));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "operation-error");
    assert.match(rejected.error.message, /sampleSeed|index/);
  }

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

  const temporalReset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: "temporal",
    op: "reset",
    family: AGENT_GYM_FAMILY_IDS.clockworkOrchard,
    split: "test",
    index: 2,
  })));
  assert.equal(temporalReset.ok, true);
  assert.equal(temporalReset.payload.info.scenarioId, "task-03-test-02");
  assert.equal(temporalReset.payload.episode.familyId, AGENT_GYM_FAMILY_IDS.clockworkOrchard);
  assert.doesNotMatch(
    `${temporalReset.payload.episode.familyId} ${temporalReset.payload.episode.scenarioId} ${temporalReset.payload.observation.scenario}`,
    /clockwork|orchard|temporal|premature|moth/i,
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
    seeded_observation, seeded_info = env.reset(seed=42, options={"split": "validation"})
    repeated_observation, repeated_info = env.reset(seed=42, options={"split": "validation"})
    observation, reset_info = env.reset("validation", 3)
    observation, reward, terminated, truncated, info = env.step({"tool": "inspect_spell"})
    print(json.dumps({
        "tools": len(description["actionSpace"]),
        "manifestProtocol": description["actionManifest"]["protocol"],
        "scenario": reset_info["scenarioId"],
        "graph": observation["id"],
        "reward": reward,
        "terminated": terminated,
        "truncated": truncated,
        "step": info["stepIndex"],
        "resultNodes": len(info["result"]["nodes"]),
        "snapshotSteps": len(env.snapshot()["trajectory"]),
        "semanticsExposed": "semantics" in observation,
        "seededRepeatable": seeded_observation == repeated_observation,
        "sampleSeed": seeded_info["sampledTask"]["sampleSeed"],
        "sampleProtocol": seeded_info["sampledTask"]["protocol"],
        "sampleScenarioRepeatable": seeded_info["scenarioId"] == repeated_info["scenarioId"],
    }))
`;
  const result = await run("python3", ["-c", script]);
  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt, {
    tools: 7,
    manifestProtocol: "hex-machina-tool-manifest/v1",
    scenario: "task-01-validation-03",
    graph: "spell-task-01-validation-03",
    reward: 1,
    terminated: false,
    truncated: false,
    step: 0,
    resultNodes: 12,
    snapshotSteps: 1,
    semanticsExposed: false,
    seededRepeatable: true,
    sampleSeed: 42,
    sampleProtocol: "hex-machina-agent-gym-sampler/v1",
    sampleScenarioRepeatable: true,
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
            "family-03-v1",
        ],
    )
    seeded_observations, seeded_info = envs.reset("validation", seed=[11, 22, 33])
    repeated_seeded_observations, repeated_seeded_info = envs.reset("validation", seed=[11, 22, 33])
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
        "seededScenarios": [info["scenarioId"] for info in seeded_info],
        "seededRepeatable": seeded_observations == repeated_seeded_observations,
        "sampleSeeds": [info["sampledTask"]["sampleSeed"] for info in seeded_info],
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
    "family-03-v1",
  ]);
  assert.deepEqual(receipt.mixedScenarios, [
    "task-01-test-00",
    "task-02-test-00",
    "task-03-test-01",
  ]);
  assert.equal(receipt.seededScenarios.length, 3);
  assert.equal(receipt.seededRepeatable, true);
  assert.deepEqual(receipt.sampleSeeds, [11, 22, 33]);
});
