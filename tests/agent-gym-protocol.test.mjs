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
  assert.equal(description.payload.actionSpace.length, 7);

  const reset = JSON.parse(await bridge.handleLine(JSON.stringify({
    id: 2,
    op: "reset",
    split: "test",
    index: 5,
  })));
  assert.equal(reset.ok, true);
  assert.equal(reset.payload.info.scenarioId, "moonflower-test-05");

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
