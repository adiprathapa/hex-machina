import { createHash } from "node:crypto";

import { auditAgentGymConstraintPreservation } from "./constraint-audit.ts";
import { measureAgentGymFamilyDiversity } from "./family-diversity.ts";
import { benchmarkAgentGymPolicies } from "./policy-benchmark.ts";
import {
  benchmarkAgentGymFamily,
  collectAgentGymDataset,
  serializeAgentGymDatasetJsonl,
} from "./reference-policy.ts";
import { verifyAgentGymDatasetJsonl } from "./replay-verifier.ts";
import { AGENT_GYM_FAMILY_SPLIT_SIZES, type AgentGymSplit } from "../scenarios/agent-gym-family.ts";

/**
 * One regenerable evidence bundle for the Agent Gym.
 *
 * The gym already reports scores, contrast policies, a leakage audit, and
 * replay verification, but each from its own command with its own output. A
 * reader had to run four things and trust that the numbers came from the same
 * build. This runs all four in one pass and emits a single deterministic
 * document, so the claims can be regenerated and diffed as a unit.
 *
 * The bundle is content-addressed. Regenerating it on an unchanged tree must
 * produce an identical digest; a changed digest means a claim moved and the
 * committed evidence is stale.
 */

export const AGENT_GYM_EVIDENCE_PROTOCOL = "hex-machina-agent-gym-evidence/v1" as const;

const SPLITS = ["train", "validation", "test"] as AgentGymSplit[];

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

export async function buildAgentGymEvidence() {
  const family = await benchmarkAgentGymFamily();
  const policies = await benchmarkAgentGymPolicies("test");

  const constraint = [];
  for (const split of SPLITS) constraint.push(await auditAgentGymConstraintPreservation(split));

  const diversity = measureAgentGymFamilyDiversity();
  const dataset = serializeAgentGymDatasetJsonl(await collectAgentGymDataset());
  const replay = await verifyAgentGymDatasetJsonl(dataset);

  const claims = {
    determinism: {
      claim: "Every exported episode replays action-for-action against a fresh environment.",
      episodes: replay.episodeCount,
      verifiedEpisodes: replay.verifiedEpisodes,
      issues: replay.issueCount,
      holds: replay.valid,
    },
    grounding: {
      claim: "A grounded policy solves held-out opaque-ID variants at full reward.",
      // Stated alongside the score, because the score alone invites a stronger
      // reading than the family supports.
      heldOutScope: diversity.heldOutScope,
      supports: diversity.supportedClaim,
      distinctStructures: diversity.structuralDiversity.distinctStructures,
      episodes: family.episodeCount,
      completed: family.completedCount,
      meanScore: family.meanScore,
      splitScores: family.splitScores,
      holds: family.completedCount === family.episodeCount,
    },
    rewardSeparation: {
      claim: "Reward distinguishes grounded repair from unsafe, incomplete, and memorizing play.",
      policies: policies.policies.map((policy) => ({
        policyId: policy.policyId,
        meanScore: policy.meanScore,
        completionRate: policy.completionRate,
        unsafeEpisodeRate: policy.unsafeEpisodeRate,
        invalidActionRate: policy.invalidActionRate,
      })),
      holds: (() => {
        const scores = policies.policies.map((policy) => policy.meanScore);
        const grounded = policies.policies.find((policy) => policy.policyId === "grounded-reference");
        return grounded !== undefined && scores.every((score) => score <= grounded.meanScore)
          && new Set(scores).size === scores.length;
      })(),
    },
    constraintPreservation: {
      claim: "Reaching the goal by discarding what the human protected is scored as a failure.",
      splits: constraint.map((report) => ({
        split: report.split,
        verdict: report.verdict,
        groundedMeanScore: report.policies.grounded.meanScore,
        violatingMeanScore: report.policies.violating.meanScore,
        violatingConstraintPreservedRate: report.policies.violating.constraintPreservedRate,
        violatingGoalVerifiedRate: report.policies.violating.goalVerifiedRate,
      })),
      holds: constraint.every((report) => report.verdict === "priced"),
    },
  };

  const body = {
    protocol: AGENT_GYM_EVIDENCE_PROTOCOL,
    familyId: "moonflower-opaque-roles-v1" as const,
    familySplitSizes: AGENT_GYM_FAMILY_SPLIT_SIZES,
    taskDiversity: diversity,
    datasetBytes: dataset.length,
    datasetDigest: digest(dataset),
    claims,
  };

  return {
    ...body,
    allClaimsHold: Object.values(claims).every((claim) => claim.holds),
    evidenceDigest: digest(body),
  };
}

/** Render the bundle as the table a judge actually reads. */
export function renderAgentGymEvidence(report: Awaited<ReturnType<typeof buildAgentGymEvidence>>) {
  const mark = (holds: boolean) => (holds ? "holds" : "FAILS");
  const lines = [
    "# Agent Gym evidence",
    "",
    `Regenerate with \`npm run gym:evidence\`. Digest \`${report.evidenceDigest}\`.`,
    "",
    "| Claim | Verdict | Evidence |",
    "| --- | --- | --- |",
    `| Deterministic replay | ${mark(report.claims.determinism.holds)} | ${report.claims.determinism.episodes} episodes, ${report.claims.determinism.verifiedEpisodes} verified, ${report.claims.determinism.issues} issues |`,
    `| Held-out grounding | ${mark(report.claims.grounding.holds)} | ${report.claims.grounding.completed}/${report.claims.grounding.episodes} complete, mean score ${report.claims.grounding.meanScore} |`,
    `| Task diversity | measured | ${report.taskDiversity.scenarioCount} scenarios, ${report.taskDiversity.structuralDiversity.distinctStructures} distinct structure(s), held out: ${report.taskDiversity.heldOutScope} |`,
    `| Reward separation | ${mark(report.claims.rewardSeparation.holds)} | ${report.claims.rewardSeparation.policies.map((policy) => `${policy.policyId} ${policy.meanScore}`).join(", ")} |`,
    `| Constraint preservation | ${mark(report.claims.constraintPreservation.holds)} | ${report.claims.constraintPreservation.splits.map((split) => `${split.split} ${split.verdict} (grounded ${split.groundedMeanScore} vs violating ${split.violatingMeanScore})`).join(", ")} |`,
    "",
    "## Policy contrast on the held-out test split",
    "",
    "| Policy | Mean score | Completion | Unsafe episodes | Invalid actions |",
    "| --- | --- | --- | --- | --- |",
    ...report.claims.rewardSeparation.policies.map((policy) => (
      `| ${policy.policyId} | ${policy.meanScore} | ${(policy.completionRate * 100).toFixed(0)}% | ${(policy.unsafeEpisodeRate * 100).toFixed(0)}% | ${(policy.invalidActionRate * 100).toFixed(0)}% |`
    )),
    "",
    "## What a held-out score here does and does not show",
    "",
    report.taskDiversity.supportedClaim,
    "",
    "| Property | Measured |",
    "| --- | --- |",
    `| Scenarios | ${report.taskDiversity.scenarioCount} across ${report.taskDiversity.familyIds.length} families |`,
    `| Splits disjoint by identifier | ${report.taskDiversity.identifierDisjoint.holds ? "yes" : "no"} (${report.taskDiversity.identifierDisjoint.distinctSeeds} distinct seeds, ${report.taskDiversity.identifierDisjoint.reusedIdentifiers} reused IDs) |`,
    `| Distinct graph structures | ${report.taskDiversity.structuralDiversity.distinctStructures} |`,
    `| Test structures unseen in training | ${report.taskDiversity.structuralDiversity.testStructuresUnseenInTraining} |`,
    `| Objectives recurring across splits | ${report.taskDiversity.promptDiversity.objectivesSharedAcrossSplits} of ${report.taskDiversity.promptDiversity.distinctObjectives} |`,
    "",
    "## Constraint preservation",
    "",
    "A policy that diagnoses correctly and then repairs the spell the way the human forbade.",
    "",
    "| Split | Verdict | Grounded score | Violating score | Violating episodes reading as goal-verified |",
    "| --- | --- | --- | --- | --- |",
    ...report.claims.constraintPreservation.splits.map((split) => (
      `| ${split.split} | ${split.verdict} | ${split.groundedMeanScore} | ${split.violatingMeanScore} | ${(split.violatingGoalVerifiedRate * 100).toFixed(0)}% |`
    )),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
