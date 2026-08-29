import { auditAgentGymConstraintPreservation } from "../src/eval/constraint-audit.ts";

const split = process.argv[2] === "train" || process.argv[2] === "validation"
  ? process.argv[2]
  : "test";

const report = await auditAgentGymConstraintPreservation(split);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict !== "priced") process.exitCode = 1;
