import { createInterface } from "node:readline";

import { createAgentGymJsonlBridge } from "../src/eval/jsonl-rollout.ts";

const bridge = createAgentGymJsonlBridge();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  if (line.trim() === "") continue;
  process.stdout.write(`${await bridge.handleLine(line)}\n`);
}
