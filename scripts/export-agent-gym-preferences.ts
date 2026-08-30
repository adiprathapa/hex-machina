import {
  collectAgentGymPreferenceGroups,
  serializeAgentGymPreferenceGroupsJsonl,
} from "../src/eval/preference-dataset.ts";
import type { AgentGymSplit } from "../src/scenarios/agent-gym-family.ts";

const splitArgument = process.argv.find((argument) => argument.startsWith("--split="));
const split = splitArgument?.slice("--split=".length) ?? "train";
if (!["train", "validation", "test"].includes(split)) {
  throw new Error("--split must be train, validation, or test");
}

const groups = await collectAgentGymPreferenceGroups(split as AgentGymSplit);
process.stdout.write(serializeAgentGymPreferenceGroupsJsonl(groups));
