import {
  createAgentGymEnvironment,
  type AgentGymStep,
} from "./agent-gym.ts";
import type { SpellObservation } from "../domain/spell.ts";
import { createSpellToolManifest } from "../tools/definitions.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  type AgentGymFamilyId,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";

export const AGENT_GYM_DATASET_SCHEMA = "hex-machina-agent-gym-episode/v2" as const;
export const MAX_REPLAY_EPISODES = 1_000;

interface DatasetEpisodeRecord {
  schema: typeof AGENT_GYM_DATASET_SCHEMA;
  environmentProtocol: "hex-machina-agent-gym/v1";
  observationSchema: "hex-machina-public-spell-graph/v1";
  actionManifest: ReturnType<typeof createSpellToolManifest>;
  familyId: AgentGymFamilyId;
  scenarioId: string;
  split: AgentGymSplit;
  variantIndex: number;
  seed: number;
  task: {
    objective: string;
    humanConstraint: string;
  };
  initialObservation: SpellObservation;
  initialStateKey: string;
  status: "running" | "complete" | "truncated";
  terminationReason: "goal-verified" | "step-limit" | null;
  score: number;
  maxScore: number;
  transitions: AgentGymStep[];
}

export interface ReplayVerificationIssue {
  line: number;
  scenarioId?: string;
  transitionIndex?: number;
  code: "invalid-json" | "invalid-record" | "duplicate-scenario" | "metadata-mismatch" | "transition-mismatch" | "terminal-mismatch";
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
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, stableValue(record[key])]),
  );
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function parseEpisode(value: unknown): DatasetEpisodeRecord | string {
  const record = recordOf(value);
  if (!record) return "Episode must be a JSON object";
  if (record.schema !== AGENT_GYM_DATASET_SCHEMA) return `schema must be ${AGENT_GYM_DATASET_SCHEMA}`;
  if (record.environmentProtocol !== "hex-machina-agent-gym/v1" ||
      record.observationSchema !== "hex-machina-public-spell-graph/v1") {
    return "environmentProtocol and observationSchema are invalid";
  }
  const actionManifest = recordOf(record.actionManifest);
  if (actionManifest?.protocol !== "hex-machina-tool-manifest/v1" || !Array.isArray(actionManifest.tools)) {
    return "actionManifest is invalid";
  }
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
  const task = recordOf(record.task);
  if (typeof record.scenarioId !== "string" || typeof record.seed !== "number" ||
      typeof task?.objective !== "string" || typeof task.humanConstraint !== "string") {
    return "scenarioId, seed, and task prompt are required";
  }
  if (!recordOf(record.initialObservation) ||
      typeof record.initialStateKey !== "string" ||
      !/^fnv1a32:[a-f0-9]{8}$/.test(record.initialStateKey)) {
    return "initialObservation and initialStateKey are invalid";
  }
  if (!Array.isArray(record.transitions) || record.transitions.length > 32) {
    return "transitions must be an array with at most 32 steps";
  }
  if (!record.transitions.every((step) => recordOf(step) && typeof (step as Record<string, unknown>).tool === "string")) {
    return "every transition must contain a string tool name";
  }
  if (!(["running", "complete", "truncated"] as unknown[]).includes(record.status) ||
      !([null, "goal-verified", "step-limit"] as unknown[]).includes(record.terminationReason) ||
      typeof record.score !== "number" || typeof record.maxScore !== "number") {
    return "terminal status, reason, and scores are invalid";
  }
  return record as unknown as DatasetEpisodeRecord;
}

export async function verifyAgentGymDatasetJsonl(jsonl: string) {
  const lines = jsonl.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const issues: ReplayVerificationIssue[] = [];
  if (lines.length === 0) {
    issues.push({ line: 0, code: "invalid-record", message: "Dataset contains no episodes" });
  }
  if (lines.length > MAX_REPLAY_EPISODES) {
    issues.push({
      line: 0,
      code: "invalid-record",
      message: `Dataset exceeds the ${MAX_REPLAY_EPISODES}-episode verification limit`,
    });
  }

  let verifiedEpisodes = 0;
  const seenScenarios = new Set<string>();
  for (const [lineIndex, line] of lines.slice(0, MAX_REPLAY_EPISODES).entries()) {
    const lineNumber = lineIndex + 1;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      issues.push({ line: lineNumber, code: "invalid-json", message: "Line is not valid JSON" });
      continue;
    }
    const parsed = parseEpisode(decoded);
    if (typeof parsed === "string") {
      issues.push({ line: lineNumber, code: "invalid-record", message: parsed });
      continue;
    }
    const startIssueCount = issues.length;
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

    const environment = createAgentGymEnvironment({
      family: parsed.familyId,
      split: parsed.split,
      index: parsed.variantIndex,
    });
    const reset = environment.reset();
    const metadata = {
      environmentProtocol: reset.episode.protocol,
      observationSchema: reset.info.observationSchema,
      actionManifest: reset.info.actionManifest,
      familyId: reset.episode.familyId,
      scenarioId: reset.episode.scenarioId,
      split: reset.episode.split,
      variantIndex: reset.episode.variantIndex,
      seed: reset.episode.seed,
      task: reset.task,
      initialObservation: reset.observation,
      initialStateKey: reset.episode.initialStateKey,
      maxScore: reset.episode.maxScore,
    };
    const expectedMetadata = {
      environmentProtocol: parsed.environmentProtocol,
      observationSchema: parsed.observationSchema,
      actionManifest: parsed.actionManifest,
      familyId: parsed.familyId,
      scenarioId: parsed.scenarioId,
      split: parsed.split,
      variantIndex: parsed.variantIndex,
      seed: parsed.seed,
      task: parsed.task,
      initialObservation: parsed.initialObservation,
      initialStateKey: parsed.initialStateKey,
      maxScore: parsed.maxScore,
    };
    if (stableJson(metadata) !== stableJson(expectedMetadata)) {
      issues.push({
        line: lineNumber,
        scenarioId: parsed.scenarioId,
        code: "metadata-mismatch",
        message: "Episode metadata does not match the deterministic reset",
      });
      continue;
    }

    for (const [transitionIndex, expected] of parsed.transitions.entries()) {
      const actual = await environment.step({
        tool: expected.tool,
        ...(Object.hasOwn(expected, "input") ? { input: expected.input } : {}),
      });
      const actualStep = actual.episode.trajectory.at(-1);
      if (!actualStep || stableJson(actualStep) !== stableJson(expected)) {
        issues.push({
          line: lineNumber,
          scenarioId: parsed.scenarioId,
          transitionIndex,
          code: "transition-mismatch",
          message: "Recorded transition differs from deterministic replay",
        });
        break;
      }
    }

    if (issues.length === startIssueCount) {
      const final = environment.snapshot();
      const terminal = {
        status: final.status,
        terminationReason: final.terminationReason,
        score: final.score,
      };
      const expectedTerminal = {
        status: parsed.status,
        terminationReason: parsed.terminationReason,
        score: parsed.score,
      };
      if (stableJson(terminal) !== stableJson(expectedTerminal)) {
        issues.push({
          line: lineNumber,
          scenarioId: parsed.scenarioId,
          code: "terminal-mismatch",
          message: "Terminal status or score differs from deterministic replay",
        });
      }
    }
    if (issues.length === startIssueCount) verifiedEpisodes += 1;
  }

  return {
    protocol: "hex-machina-agent-gym-replay-verifier/v1" as const,
    valid: issues.length === 0,
    episodeCount: lines.length,
    verifiedEpisodes,
    issueCount: issues.length,
    issues,
  };
}
