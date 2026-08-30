import type { SpellObservation } from "../domain/spell.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  type AgentGymFamilyId,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";
import { createSpellToolManifest } from "../tools/definitions.ts";
import type { AgentGymSnapshot, AgentGymStep } from "./agent-gym.ts";
import {
  AGENT_GYM_POLICY_BASELINES,
  runAgentGymPolicy,
  type AgentGymPolicyId,
} from "./policy-benchmark.ts";

export const AGENT_GYM_PREFERENCE_SCHEMA = "hex-machina-agent-gym-preference-group/v2" as const;
export const AGENT_GYM_PREFERENCE_VERIFIER_PROTOCOL = "hex-machina-agent-gym-preference-verifier/v2" as const;
export const MAX_PREFERENCE_GROUPS = 256;

function pairCount(candidateCount: number) {
  return candidateCount * (candidateCount - 1) / 2;
}

function stableDecimal(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export interface AgentGymPreferenceCandidate {
  policyId: AgentGymPolicyId;
  rank: number;
  reward: number;
  advantage: number;
  status: AgentGymSnapshot["status"];
  terminationReason: AgentGymSnapshot["terminationReason"];
  unsafeMutation: boolean;
  constraintViolation: boolean;
  constraintPreserved: boolean | null;
  invalidActionCount: number;
  actionCount: number;
  transitions: AgentGymStep[];
}

export interface AgentGymPreferenceGroup {
  schema: typeof AGENT_GYM_PREFERENCE_SCHEMA;
  environmentProtocol: "hex-machina-agent-gym/v1";
  observationSchema: "hex-machina-public-spell-graph/v1";
  actionManifest: ReturnType<typeof createSpellToolManifest>;
  familyId: AgentGymFamilyId;
  scenarioId: string;
  split: AgentGymSplit;
  variantIndex: number;
  seed: number;
  task: AgentGymSnapshot["task"];
  initialObservation: SpellObservation;
  initialStateKey: string;
  maxScore: number;
  groupMeanReward: number;
  candidates: AgentGymPreferenceCandidate[];
  preferencePairs: Array<{
    chosenPolicyId: AgentGymPolicyId;
    rejectedPolicyId: AgentGymPolicyId;
    rewardMargin: number;
  }>;
}

export interface PreferenceVerificationIssue {
  line: number;
  scenarioId?: string;
  code: "invalid-json" | "invalid-record" | "duplicate-scenario" | "group-mismatch";
  message: string;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const record = recordOf(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function candidateFromSnapshot(
  policyId: AgentGymPolicyId,
  snapshot: AgentGymSnapshot,
): Omit<AgentGymPreferenceCandidate, "rank" | "advantage"> {
  return {
    policyId,
    reward: snapshot.score,
    status: snapshot.status,
    terminationReason: snapshot.terminationReason,
    unsafeMutation: snapshot.trajectory.some((step) => (
      step.rewardReasons.some((reason) => reason.includes("before explaining"))
    )),
    constraintViolation: snapshot.terminationReason === "constraint-violated",
    constraintPreserved: snapshot.constraintPreserved,
    invalidActionCount: snapshot.trajectory.filter((step) => step.error !== undefined).length,
    actionCount: snapshot.trajectory.length,
    transitions: snapshot.trajectory,
  };
}

export async function buildAgentGymPreferenceGroup(options: {
  family: AgentGymFamilyId;
  split: AgentGymSplit;
  index: number;
}): Promise<AgentGymPreferenceGroup> {
  const policyIds = AGENT_GYM_POLICY_BASELINES.map((baseline) => baseline.id);
  const snapshots = await Promise.all(policyIds.map((policyId) => runAgentGymPolicy(policyId, options)));
  const reference = snapshots[0];
  if (!snapshots.every((snapshot) => (
    snapshot.scenarioId === reference.scenarioId &&
    stableJson(snapshot.task) === stableJson(reference.task) &&
    stableJson(snapshot.initialObservation) === stableJson(reference.initialObservation) &&
    snapshot.initialStateKey === reference.initialStateKey
  ))) {
    throw new Error("Preference candidates do not share one deterministic reset context");
  }

  const projected = snapshots.map((snapshot, index) => (
    candidateFromSnapshot(policyIds[index], snapshot)
  ));
  const groupMeanReward = stableDecimal(
    projected.reduce((total, candidate) => total + candidate.reward, 0) / projected.length,
  );
  const candidates = projected
    .sort((left, right) => right.reward - left.reward || left.policyId.localeCompare(right.policyId))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      advantage: stableDecimal(candidate.reward - groupMeanReward),
    }));
  const preferencePairs = candidates.flatMap((chosen, chosenIndex) => (
    candidates.slice(chosenIndex + 1).map((rejected) => ({
      chosenPolicyId: chosen.policyId,
      rejectedPolicyId: rejected.policyId,
      rewardMargin: chosen.reward - rejected.reward,
    }))
  ));

  return {
    schema: AGENT_GYM_PREFERENCE_SCHEMA,
    environmentProtocol: reference.protocol,
    observationSchema: "hex-machina-public-spell-graph/v1",
    actionManifest: createSpellToolManifest(),
    familyId: reference.familyId,
    scenarioId: reference.scenarioId,
    split: options.split,
    variantIndex: options.index,
    seed: reference.seed,
    task: reference.task,
    initialObservation: reference.initialObservation,
    initialStateKey: reference.initialStateKey,
    maxScore: reference.maxScore,
    groupMeanReward,
    candidates,
    preferencePairs,
  };
}

export async function collectAgentGymPreferenceGroups(split: AgentGymSplit = "train") {
  const groups: AgentGymPreferenceGroup[] = [];
  for (const family of Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[]) {
    for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[family][split]; index += 1) {
      groups.push(await buildAgentGymPreferenceGroup({ family, split, index }));
    }
  }
  return groups;
}

export function serializeAgentGymPreferenceGroupsJsonl(groups: AgentGymPreferenceGroup[]) {
  return `${groups.map((group) => JSON.stringify(group)).join("\n")}\n`;
}

function parseGroup(value: unknown): AgentGymPreferenceGroup | string {
  const record = recordOf(value);
  if (!record) return "Preference group must be a JSON object";
  if (record.schema !== AGENT_GYM_PREFERENCE_SCHEMA) return `schema must be ${AGENT_GYM_PREFERENCE_SCHEMA}`;
  if (typeof record.familyId !== "string" || !Object.hasOwn(AGENT_GYM_FAMILY_SPLIT_SIZES, record.familyId)) {
    return "familyId is unknown";
  }
  if (typeof record.split !== "string" || !["train", "validation", "test"].includes(record.split)) {
    return "split must be train, validation, or test";
  }
  const familyId = record.familyId as AgentGymFamilyId;
  const split = record.split as AgentGymSplit;
  if (!Number.isInteger(record.variantIndex) || (record.variantIndex as number) < 0 ||
      (record.variantIndex as number) >= AGENT_GYM_FAMILY_SPLIT_SIZES[familyId][split]) {
    return "variantIndex is outside the selected family split";
  }
  const candidateCount = AGENT_GYM_POLICY_BASELINES.length;
  if (typeof record.scenarioId !== "string" || !Array.isArray(record.candidates) ||
      record.candidates.length !== candidateCount ||
      !Array.isArray(record.preferencePairs) || record.preferencePairs.length !== pairCount(candidateCount)) {
    return `scenarioId, ${candidateCount} candidates, and ${pairCount(candidateCount)} preference pairs are required`;
  }
  return record as unknown as AgentGymPreferenceGroup;
}

export async function verifyAgentGymPreferenceGroupsJsonl(jsonl: string) {
  const lines = jsonl.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const issues: PreferenceVerificationIssue[] = [];
  if (lines.length === 0) {
    issues.push({ line: 0, code: "invalid-record", message: "Dataset contains no preference groups" });
  }
  if (lines.length > MAX_PREFERENCE_GROUPS) {
    issues.push({
      line: 0,
      code: "invalid-record",
      message: `Dataset exceeds the ${MAX_PREFERENCE_GROUPS}-group verification limit`,
    });
  }

  let verifiedGroups = 0;
  const seenScenarios = new Set<string>();
  for (const [lineIndex, line] of lines.slice(0, MAX_PREFERENCE_GROUPS).entries()) {
    const lineNumber = lineIndex + 1;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      issues.push({ line: lineNumber, code: "invalid-json", message: "Line is not valid JSON" });
      continue;
    }
    const parsed = parseGroup(decoded);
    if (typeof parsed === "string") {
      issues.push({ line: lineNumber, code: "invalid-record", message: parsed });
      continue;
    }
    if (seenScenarios.has(parsed.scenarioId)) {
      issues.push({
        line: lineNumber,
        scenarioId: parsed.scenarioId,
        code: "duplicate-scenario",
        message: "Scenario appears more than once",
      });
      continue;
    }
    seenScenarios.add(parsed.scenarioId);

    const expected = await buildAgentGymPreferenceGroup({
      family: parsed.familyId,
      split: parsed.split,
      index: parsed.variantIndex,
    });
    if (stableJson(expected) !== stableJson(parsed)) {
      issues.push({
        line: lineNumber,
        scenarioId: parsed.scenarioId,
        code: "group-mismatch",
        message: "Preference group differs from deterministic policy regeneration",
      });
      continue;
    }
    verifiedGroups += 1;
  }

  return {
    protocol: AGENT_GYM_PREFERENCE_VERIFIER_PROTOCOL,
    valid: issues.length === 0,
    groupCount: lines.length,
    verifiedGroups,
    issueCount: issues.length,
    issues,
  };
}
