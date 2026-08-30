import { readFileSync } from "node:fs";

import { verifyAgentGymPreferenceGroupsJsonl } from "../src/eval/preference-dataset.ts";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const input = readFileSync(0, "utf8");
if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
  process.stderr.write("Agent Gym preference dataset exceeds the 64 MiB verification limit.\n");
  process.exitCode = 1;
} else {
  const receipt = await verifyAgentGymPreferenceGroupsJsonl(input);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.valid) process.exitCode = 1;
}
