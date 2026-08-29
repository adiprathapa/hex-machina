import { benchmarkStructuralTransfer } from "../src/eval/transfer-protocol.ts";

const report = await benchmarkStructuralTransfer();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.holds) process.exitCode = 1;
