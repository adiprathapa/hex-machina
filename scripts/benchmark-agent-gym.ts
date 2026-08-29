import { benchmarkAgentGymFamily } from "../src/eval/reference-policy.ts";

const result = await benchmarkAgentGymFamily();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
