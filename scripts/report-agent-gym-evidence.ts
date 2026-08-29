import { writeFile } from "node:fs/promises";

import {
  buildAgentGymEvidence,
  renderAgentGymEvidence,
} from "../src/eval/evidence-report.ts";

const report = await buildAgentGymEvidence();
const markdown = renderAgentGymEvidence(report);

// `--write` refreshes the committed evidence; the default prints so the report
// can be inspected without touching the tree.
if (process.argv.includes("--write")) {
  await writeFile(new URL("../submission/agent-gym-evidence.md", import.meta.url), markdown);
  await writeFile(
    new URL("../submission/agent-gym-evidence.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

process.stdout.write(markdown);
if (!report.allClaimsHold) process.exitCode = 1;
