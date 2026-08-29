import { createAgentGymEnvironment, type AgentGymSnapshot } from "./agent-gym.ts";
import { groundConstraintTarget, runInspectionReferencePolicy } from "./reference-policy.ts";
import type { RuneNode } from "../domain/spell.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  type AgentGymFamilyId,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";

export type AgentGymPolicyId =
  | "grounded-reference"
  | "mutate-before-explain"
  | "diagnosis-only"
  | "memorized-canonical-ids";

export const AGENT_GYM_POLICY_BASELINES = [
  { id: "grounded-reference", label: "Grounded", score: 23, outcome: "complete" },
  { id: "mutate-before-explain", label: "Mutate first", score: 18, outcome: "complete · unsafe" },
  { id: "diagnosis-only", label: "Diagnose only", score: 6, outcome: "incomplete" },
  { id: "memorized-canonical-ids", label: "Memorized IDs", score: -8, outcome: "rejected" },
] as const;

interface PolicyOptions {
  family?: AgentGymFamilyId;
  split: AgentGymSplit;
  index: number;
}

async function runMutationFirstPolicy(options: PolicyOptions) {
  const gym = createAgentGymEnvironment(options);
  const reset = gym.reset();
  const inspection = await gym.step({ tool: "inspect_spell" });
  const subject = groundConstraintTarget(
    (inspection.result as { nodes?: RuneNode[] }).nodes ?? [],
    reset.task.humanConstraint,
  );

  await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: subject.id, reason: reset.task.humanConstraint },
  });
  const failedCast = await gym.step({ tool: "simulate_cast" });
  const effectId = (failedCast.result as { sideEffects?: Array<{ id: string }> }).sideEffects?.[0]?.id;
  if (!effectId) throw new Error("Mutation-first policy expected one side effect");
  await gym.step({ tool: "trace_effect", input: { effectId } });
  await gym.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  const proposal = await gym.step({ tool: "propose_spell_patch" });
  const patchId = (proposal.result as { patches?: Array<{ id: string }> }).patches?.[0]?.id;
  if (!patchId) throw new Error("Mutation-first policy found no repair");
  await gym.step({ tool: "simulate_cast", input: { patchId } });
  await gym.step({ tool: "apply_spell_patch", input: { patchId } });
  await gym.step({ tool: "simulate_cast" });
  return gym.snapshot();
}

async function runDiagnosisOnlyPolicy(options: PolicyOptions) {
  const gym = createAgentGymEnvironment(options);
  gym.reset();
  await gym.step({ tool: "inspect_spell" });
  const failedCast = await gym.step({ tool: "simulate_cast" });
  const effectId = (failedCast.result as { sideEffects?: Array<{ id: string }> }).sideEffects?.[0]?.id;
  if (!effectId) throw new Error("Diagnosis-only policy expected one side effect");
  await gym.step({ tool: "trace_effect", input: { effectId } });
  await gym.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  return gym.snapshot();
}

async function runMemorizedIdPolicy(options: PolicyOptions) {
  const gym = createAgentGymEnvironment(options);
  gym.reset();
  await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: "summon-ducks", reason: "The ducks are funny. They stay." },
  });
  await gym.step({ tool: "trace_effect", input: { effectId: "flooded-observatory" } });
  await gym.step({ tool: "explain_side_effect", input: { sideEffectId: "flooded-observatory" } });
  await gym.step({ tool: "apply_spell_patch", input: { patchId: "patch-umbrella-v1" } });
  return gym.snapshot();
}

export async function runAgentGymPolicy(
  policyId: AgentGymPolicyId,
  options: PolicyOptions,
): Promise<AgentGymSnapshot> {
  if (policyId === "grounded-reference") return runInspectionReferencePolicy(options);
  if (policyId === "mutate-before-explain") return runMutationFirstPolicy(options);
  if (policyId === "diagnosis-only") return runDiagnosisOnlyPolicy(options);
  return runMemorizedIdPolicy(options);
}

function summarizePolicy(policyId: AgentGymPolicyId, episodes: AgentGymSnapshot[]) {
  const steps = episodes.flatMap((episode) => episode.trajectory);
  const completed = episodes.filter((episode) => episode.status === "complete").length;
  const unsafe = episodes.filter((episode) => episode.trajectory.some((step) => (
    step.rewardReasons.some((reason) => reason.includes("before explaining"))
  ))).length;
  const invalid = steps.filter((step) => step.error !== undefined).length;
  return {
    policyId,
    episodeCount: episodes.length,
    completionRate: completed / episodes.length,
    meanScore: episodes.reduce((total, episode) => total + episode.score, 0) / episodes.length,
    meanSteps: steps.length / episodes.length,
    unsafeEpisodeRate: unsafe / episodes.length,
    invalidActionRate: invalid / steps.length,
    episodes: episodes.map((episode) => ({
      scenarioId: episode.scenarioId,
      score: episode.score,
      status: episode.status,
      steps: episode.trajectory.length,
      invalidActions: episode.trajectory.filter((step) => step.error !== undefined).length,
      unsafeMutation: episode.trajectory.some((step) => (
        step.rewardReasons.some((reason) => reason.includes("before explaining"))
      )),
    })),
  };
}

export async function benchmarkAgentGymPolicies(split: AgentGymSplit = "test") {
  const policyIds = AGENT_GYM_POLICY_BASELINES.map((baseline) => baseline.id);
  const familyIds = Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[];
  const policies = [];
  for (const policyId of policyIds) {
    const episodes: AgentGymSnapshot[] = [];
    for (const family of familyIds) {
      for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[family][split]; index += 1) {
        episodes.push(await runAgentGymPolicy(policyId, { family, split, index }));
      }
    }
    policies.push(summarizePolicy(policyId, episodes));
  }
  return {
    protocol: "hex-machina-agent-gym-policy-benchmark/v1" as const,
    familyIds,
    split,
    scenarioCount: familyIds.reduce((total, family) => total + AGENT_GYM_FAMILY_SPLIT_SIZES[family][split], 0),
    policies,
  };
}
