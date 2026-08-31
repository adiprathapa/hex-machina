import { createHash } from "node:crypto";

import { auditAgentGymConstraintPreservation } from "./constraint-audit.ts";
import { measureAgentGymFamilyDiversity } from "./family-diversity.ts";
import { benchmarkStructuralTransfer } from "./transfer-protocol.ts";
import { benchmarkAgentGymPolicies } from "./policy-benchmark.ts";
import {
  collectAgentGymPreferenceGroups,
  serializeAgentGymPreferenceGroupsJsonl,
  verifyAgentGymPreferenceGroupsJsonl,
} from "./preference-dataset.ts";
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

export const AGENT_GYM_EVIDENCE_PROTOCOL = "hex-machina-agent-gym-evidence/v2" as const;

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
  const transfer = await benchmarkStructuralTransfer();
  const dataset = serializeAgentGymDatasetJsonl(await collectAgentGymDataset());
  const replay = await verifyAgentGymDatasetJsonl(dataset);
  const preferenceGroups = await collectAgentGymPreferenceGroups("train");
  const preferenceDataset = serializeAgentGymPreferenceGroupsJsonl(preferenceGroups);
  const preferenceVerification = await verifyAgentGymPreferenceGroupsJsonl(preferenceDataset);
  const preferenceExample = preferenceGroups[0];

  const claims = {
    determinism: {
      claim: "Every exported episode replays action-for-action against a fresh environment.",
      episodes: replay.episodeCount,
      verifiedEpisodes: replay.verifiedEpisodes,
      issues: replay.issueCount,
      holds: replay.valid,
    },
    preferenceIntegrity: {
      claim: "Every group-relative training record is regenerated from five executable policies and verifies exactly.",
      groups: preferenceVerification.groupCount,
      verifiedGroups: preferenceVerification.verifiedGroups,
      issues: preferenceVerification.issueCount,
      candidatesPerGroup: preferenceExample?.candidates.length ?? 0,
      pairsPerGroup: preferenceExample?.preferencePairs.length ?? 0,
      rewards: preferenceExample?.candidates.map((candidate) => candidate.reward) ?? [],
      advantages: preferenceExample?.candidates.map((candidate) => candidate.advantage) ?? [],
      constraintViolationPolicies: preferenceExample?.candidates
        .filter((candidate) => candidate.constraintViolation)
        .map((candidate) => candidate.policyId) ?? [],
      holds: preferenceVerification.valid && preferenceGroups.every((group) => (
        group.candidates.length === 5 &&
        group.preferencePairs.length === 10 &&
        group.preferencePairs.every((pair) => pair.rewardMargin > 0) &&
        group.candidates.filter((candidate) => candidate.constraintViolation).length === 1 &&
        group.candidates.find((candidate) => candidate.policyId === "constraint-violating")?.constraintPreserved === false
      )),
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
      claim: "Reward distinguishes grounded repair from unsafe, incomplete, human-overruling, and memorizing play.",
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
    structuralTransfer: {
      claim: "A grounded policy solves a scenario family whose structure was withheld from training; a policy that memorized training vocabulary does not.",
      protocols: transfer.results.map((result) => ({
        heldOutFamily: result.heldOutFamily,
        trainingFamilies: result.trainingFamilies,
        groundedMeanScore: result.policies.grounded.meanScore,
        groundedCompletionRate: result.policies.grounded.completionRate,
        memorizingMeanScore: result.policies.memorizing.meanScore,
        memorizingCompletionRate: result.policies.memorizing.completionRate,
        separation: result.separation,
      })),
      holds: transfer.holds,
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
    preferenceDatasetBytes: preferenceDataset.length,
    preferenceDatasetDigest: digest(preferenceDataset),
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
    `| Preference integrity | ${mark(report.claims.preferenceIntegrity.holds)} | ${report.claims.preferenceIntegrity.groups} groups, ${report.claims.preferenceIntegrity.verifiedGroups} verified, ${report.claims.preferenceIntegrity.candidatesPerGroup} policies and ${report.claims.preferenceIntegrity.pairsPerGroup} pairs per group |`,
    `| Held-out grounding | ${mark(report.claims.grounding.holds)} | ${report.claims.grounding.completed}/${report.claims.grounding.episodes} complete, mean score ${report.claims.grounding.meanScore} |`,
    `| Task diversity | measured | ${report.taskDiversity.scenarioCount} scenarios, ${report.taskDiversity.structuralDiversity.distinctStructures} distinct structure(s), held out: ${report.taskDiversity.heldOutScope} |`,
    `| Reward separation | ${mark(report.claims.rewardSeparation.holds)} | ${report.claims.rewardSeparation.policies.map((policy) => `${policy.policyId} ${policy.meanScore}`).join(", ")} |`,
    `| Structural transfer | ${mark(report.claims.structuralTransfer.holds)} | ${report.claims.structuralTransfer.protocols.map((protocol) => `hold out ${protocol.heldOutFamily}: grounded ${protocol.groundedMeanScore} vs memorizing ${protocol.memorizingMeanScore}`).join(", ")} |`,
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
    "## Group-relative training data",
    "",
    `The train split contains ${report.claims.preferenceIntegrity.groups} independently reset task groups. Each group reruns the five policies above against one shared task and emits all ${report.claims.preferenceIntegrity.pairsPerGroup} strict chosen/rejected comparisons. The complete JSONL artifact is content-addressed as \`${report.preferenceDatasetDigest}\` (${report.preferenceDatasetBytes} bytes).`,
    "",
    "| Ranked rewards | Centered advantages | Constraint-violating policies | Verified groups | Issues |",
    "| --- | --- | --- | --- | --- |",
    `| ${report.claims.preferenceIntegrity.rewards.join(" / ")} | ${report.claims.preferenceIntegrity.advantages.join(" / ")} | ${report.claims.preferenceIntegrity.constraintViolationPolicies.join(", ")} | ${report.claims.preferenceIntegrity.verifiedGroups} | ${report.claims.preferenceIntegrity.issues} |`,
    "",
    "## What the default splits hold out",
    "",
    report.taskDiversity.supportedClaim,
    "",
    "For structural evidence, see the transfer protocol below, which withholds an entire scenario family.",
    "",
    "| Property | Measured |",
    "| --- | --- |",
    `| Scenarios | ${report.taskDiversity.scenarioCount} across ${report.taskDiversity.familyIds.length} families |`,
    `| Splits disjoint by identifier | ${report.taskDiversity.identifierDisjoint.holds ? "yes" : "no"} (${report.taskDiversity.identifierDisjoint.distinctSeeds} distinct seeds, ${report.taskDiversity.identifierDisjoint.reusedIdentifiers} reused IDs) |`,
    `| Distinct graph structures | ${report.taskDiversity.structuralDiversity.distinctStructures} |`,
    `| Test structures unseen in training | ${report.taskDiversity.structuralDiversity.testStructuresUnseenInTraining} |`,
    `| Test structures unseen in training, ignoring benign decoys | ${report.taskDiversity.structuralDiversity.causalStructuresUnseenInTraining} |`,
    `| Objectives recurring across splits | ${report.taskDiversity.promptDiversity.objectivesSharedAcrossSplits} of ${report.taskDiversity.promptDiversity.distinctObjectives} |`,
    "",
    "## Structural transfer",
    "",
    "A separate protocol from the default splits above. Each family is withheld from training in turn and evaluated on its own test split, so what is held out is a graph structure rather than a set of identifiers. The contrast policy is identical to the grounded one except that it grounds the protected subject by recalling a rune label from the training family.",
    "",
    "| Held-out family | Trained on | Grounded score | Grounded completion | Memorizing score | Memorizing completion |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.claims.structuralTransfer.protocols.map((protocol) => (
      `| ${protocol.heldOutFamily} | ${protocol.trainingFamilies.join(", ")} | ${protocol.groundedMeanScore} | ${(protocol.groundedCompletionRate * 100).toFixed(0)}% | ${protocol.memorizingMeanScore} | ${(protocol.memorizingCompletionRate * 100).toFixed(0)}% |`
    )),
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
