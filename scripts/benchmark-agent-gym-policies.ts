import { benchmarkAgentGymPolicies } from "../src/eval/policy-benchmark.ts";
import type { AgentGymSplit } from "../src/scenarios/agent-gym-family.ts";

const splitArgument = process.argv.find((argument) => argument.startsWith("--split="));
const split = splitArgument?.slice("--split=".length) ?? "test";
if (!["train", "validation", "test"].includes(split)) {
  throw new Error("--split must be train, validation, or test");
}

const result = await benchmarkAgentGymPolicies(split as AgentGymSplit);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
