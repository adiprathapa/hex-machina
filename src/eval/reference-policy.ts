import { createAgentGymEnvironment, type AgentGymSnapshot } from "./agent-gym.ts";
import {
  AGENT_GYM_SPLIT_SIZES,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";

export async function runInspectionReferencePolicy(options?: {
  split: AgentGymSplit;
  index: number;
}): Promise<AgentGymSnapshot> {
  const gym = createAgentGymEnvironment(options);
  const reset = gym.reset();
  const inspection = await gym.step({ tool: "inspect_spell" });
  const subject = inspection.observation.nodes.find((node) => node.label === "Summon ducks");
  if (!subject) throw new Error("Reference policy could not ground the protected subject from inspection");

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
    scenarioId: string;
    split: AgentGymSplit;
    score: number;
    maxScore: number;
    status: AgentGymSnapshot["status"];
    steps: number;
  }> = [];

  for (const split of Object.keys(AGENT_GYM_SPLIT_SIZES) as AgentGymSplit[]) {
    for (let index = 0; index < AGENT_GYM_SPLIT_SIZES[split]; index += 1) {
      const episode = await runInspectionReferencePolicy({ split, index });
      episodes.push({
        scenarioId: episode.scenarioId,
        split,
        score: episode.score,
        maxScore: episode.maxScore,
        status: episode.status,
        steps: episode.trajectory.length,
      });
    }
  }

  return {
    protocol: "hex-machina-agent-gym-benchmark/v1" as const,
    familyId: "moonflower-opaque-roles-v1" as const,
    episodeCount: episodes.length,
    completedCount: episodes.filter((episode) => episode.status === "complete").length,
    meanScore: episodes.reduce((total, episode) => total + episode.score, 0) / episodes.length,
    splitScores: Object.fromEntries(
      (Object.keys(AGENT_GYM_SPLIT_SIZES) as AgentGymSplit[]).map((split) => {
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
    : Object.keys(AGENT_GYM_SPLIT_SIZES) as AgentGymSplit[];
  const episodes: AgentGymSnapshot[] = [];
  for (const selectedSplit of splits) {
    for (let index = 0; index < AGENT_GYM_SPLIT_SIZES[selectedSplit]; index += 1) {
      episodes.push(await runInspectionReferencePolicy({ split: selectedSplit, index }));
    }
  }
  return episodes;
}

export function serializeAgentGymDatasetJsonl(episodes: AgentGymSnapshot[]) {
  return `${episodes.map((episode) => JSON.stringify({
    schema: "hex-machina-agent-gym-episode/v1",
    familyId: episode.familyId,
    scenarioId: episode.scenarioId,
    split: episode.split,
    seed: episode.seed,
    objective: episode.objective,
    status: episode.status,
    terminationReason: episode.terminationReason,
    score: episode.score,
    maxScore: episode.maxScore,
    transitions: episode.trajectory,
  })).join("\n")}\n`;
}
