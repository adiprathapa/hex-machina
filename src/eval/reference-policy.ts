import { createAgentGymEnvironment, type AgentGymSnapshot } from "./agent-gym.ts";
import type { RuneNode } from "../domain/spell.ts";
import { AGENT_GYM_DATASET_SCHEMA } from "./replay-verifier.ts";
import { createSpellToolManifest } from "../tools/definitions.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  type AgentGymFamilyId,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";

const GROUNDING_STOP_WORDS = new Set([
  "all", "and", "are", "around", "branch", "desired", "do", "every", "final",
  "human", "in", "is", "keep", "must", "not", "of", "outcome", "part", "preserve",
  "remain", "repair", "so", "stay", "the", "their", "they", "to", "values",
]);

function lexicalTerms(text: string) {
  return new Set(
    text.toLowerCase().match(/[a-z0-9]+/g)?.flatMap((term) => {
      if (GROUNDING_STOP_WORDS.has(term)) return [];
      if (term.endsWith("ies") && term.length > 4) return [term, `${term.slice(0, -3)}y`];
      if (term.endsWith("s") && term.length > 4) return [term, term.slice(0, -1)];
      return [term];
    }) ?? [],
  );
}

/** Transparent baseline grounding: match protected intent to inspected rune text, never hidden roles. */
export function groundConstraintTarget(nodes: RuneNode[], humanConstraint: string) {
  const intentTerms = lexicalTerms(humanConstraint);
  const ranked = nodes
    .filter((node) => node.kind === "verb" && !node.dormant)
    .map((node) => {
      const labelTerms = lexicalTerms(node.label);
      const descriptionTerms = lexicalTerms(node.description);
      const labelMatches = [...intentTerms].filter((term) => labelTerms.has(term)).length;
      const descriptionMatches = [...intentTerms].filter((term) => descriptionTerms.has(term)).length;
      return { node, score: labelMatches * 4 + descriptionMatches };
    })
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));
  if (!ranked[0] || ranked[0].score <= 0) {
    throw new Error("Reference policy could not ground the protected subject from inspected rune evidence");
  }
  return ranked[0].node;
}

export async function runInspectionReferencePolicy(options?: {
  family?: AgentGymFamilyId;
  split: AgentGymSplit;
  index: number;
}): Promise<AgentGymSnapshot> {
  const gym = createAgentGymEnvironment(options);
  const reset = gym.reset();
  const inspection = await gym.step({ tool: "inspect_spell" });
  const inspected = inspection.result as { nodes?: RuneNode[] };
  const subject = groundConstraintTarget(inspected.nodes ?? [], reset.task.humanConstraint);

  const failedCast = await gym.step({ tool: "simulate_cast" });
  const castResult = failedCast.result as { sideEffects?: Array<{ id: string }> };
  const effectId = castResult.sideEffects?.[0]?.id;
  if (!effectId) throw new Error("Reference policy expected one observable side effect");

  await gym.step({ tool: "trace_effect", input: { effectId } });
  await gym.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: subject.id, reason: reset.task.humanConstraint },
  });
  const proposal = await gym.step({ tool: "propose_spell_patch" });
  const proposalResult = proposal.result as { patches?: Array<{ id: string }> };
  const patchId = proposalResult.patches?.[0]?.id;
  if (!patchId) throw new Error("Reference policy found no eligible repair");

  await gym.step({ tool: "simulate_cast", input: { patchId } });
  await gym.step({ tool: "apply_spell_patch", input: { patchId } });
  await gym.step({ tool: "simulate_cast" });
  return gym.snapshot();
}

export async function benchmarkAgentGymFamily() {
  const episodes: Array<{
    familyId: AgentGymFamilyId;
    scenarioId: string;
    split: AgentGymSplit;
    score: number;
    maxScore: number;
    status: AgentGymSnapshot["status"];
    steps: number;
  }> = [];

  for (const familyId of Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[]) {
    for (const split of Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES[familyId]) as AgentGymSplit[]) {
      for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[familyId][split]; index += 1) {
        const episode = await runInspectionReferencePolicy({ family: familyId, split, index });
        episodes.push({
          familyId: episode.familyId,
          scenarioId: episode.scenarioId,
          split,
          score: episode.score,
          maxScore: episode.maxScore,
          status: episode.status,
          steps: episode.trajectory.length,
        });
      }
    }
  }

  return {
    protocol: "hex-machina-agent-gym-benchmark/v1" as const,
    familyIds: Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[],
    episodeCount: episodes.length,
    completedCount: episodes.filter((episode) => episode.status === "complete").length,
    meanScore: episodes.reduce((total, episode) => total + episode.score, 0) / episodes.length,
    splitScores: Object.fromEntries(
      (["train", "validation", "test"] as AgentGymSplit[]).map((split) => {
        const selected = episodes.filter((episode) => episode.split === split);
        return [split, selected.reduce((total, episode) => total + episode.score, 0) / selected.length];
      }),
    ) as Record<AgentGymSplit, number>,
    episodes,
  };
}

export async function collectAgentGymDataset(split?: AgentGymSplit) {
  const splits = split
    ? [split]
    : ["train", "validation", "test"] as AgentGymSplit[];
  const episodes: AgentGymSnapshot[] = [];
  for (const familyId of Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[]) {
    for (const selectedSplit of splits) {
      for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[familyId][selectedSplit]; index += 1) {
        episodes.push(await runInspectionReferencePolicy({ family: familyId, split: selectedSplit, index }));
      }
    }
  }
  return episodes;
}

export function serializeAgentGymDatasetJsonl(episodes: AgentGymSnapshot[]) {
  return `${episodes.map((episode) => JSON.stringify({
    schema: AGENT_GYM_DATASET_SCHEMA,
    environmentProtocol: episode.protocol,
    observationSchema: "hex-machina-public-spell-graph/v1",
    actionManifest: createSpellToolManifest(),
    familyId: episode.familyId,
    scenarioId: episode.scenarioId,
    split: episode.split,
    variantIndex: episode.variantIndex,
    seed: episode.seed,
    task: episode.task,
    initialObservation: episode.initialObservation,
    initialStateKey: episode.initialStateKey,
    status: episode.status,
    terminationReason: episode.terminationReason,
    score: episode.score,
    maxScore: episode.maxScore,
    transitions: episode.trajectory,
  })).join("\n")}\n`;
}
