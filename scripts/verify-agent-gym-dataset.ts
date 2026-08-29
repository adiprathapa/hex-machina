import { readFileSync } from "node:fs";

import { verifyAgentGymDatasetJsonl } from "../src/eval/replay-verifier.ts";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const input = readFileSync(0, "utf8");
if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
  process.stderr.write("Agent Gym dataset exceeds the 20 MiB verification limit.\n");
  process.exitCode = 1;
} else {
  const receipt = await verifyAgentGymDatasetJsonl(input);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.valid) process.exitCode = 1;
}
