import {
  collectAgentGymDataset,
  serializeAgentGymDatasetJsonl,
} from "../src/eval/reference-policy.ts";
import type { AgentGymSplit } from "../src/scenarios/agent-gym-family.ts";

const splitArgument = process.argv.find((argument) => argument.startsWith("--split="));
const split = splitArgument?.slice("--split=".length);
if (split !== undefined && !["train", "validation", "test"].includes(split)) {
  throw new Error("--split must be train, validation, or test");
}

const episodes = await collectAgentGymDataset(split as AgentGymSplit | undefined);
process.stdout.write(serializeAgentGymDatasetJsonl(episodes));
