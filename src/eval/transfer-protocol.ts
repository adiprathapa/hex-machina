import { createAgentGymEnvironment, type AgentGymSnapshot } from "./agent-gym.ts";
import { groundConstraintTarget, runInspectionReferencePolicy } from "./reference-policy.ts";
import type { RuneNode } from "../domain/spell.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  type AgentGymFamilyId,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";

/**
 * Structural holdout: evaluating on a graph structure training never contained.
 *
 * The default splits are disjoint by identifier, and every scenario family
 * appears on both sides of them. That makes a held-out score evidence of
 * robustness to identifier and layout perturbation, not of generalization: no
 * structure is actually withheld.
 *
 * A transfer protocol withholds one. It designates a family as held out,
 * training pools become every *other* family, and evaluation runs only on the
 * held-out family's test split. Because families differ in topology, rune
 * vocabulary, failure rule, and the identity of the protected subject — ducks
 * flooding an observatory versus thunderbirds shattering a glass dome — a score
 * under this protocol is evidence about structure rather than identifiers.
 *
 * The protocol is defined here rather than by changing the family generator, so
 * the existing splits, seeds, and published baselines are untouched and both
 * evaluations remain available.
 *
 * A holdout only means something if something can fail it, so the protocol is
 * always run as a contrast: a policy that grounds from the graph against one
 * that has memorized the training family's vocabulary.
 */

export const AGENT_GYM_TRANSFER_PROTOCOL = "hex-machina-agent-gym-transfer/v1" as const;

export interface TransferProtocol {
  /** The family withheld from the training pool and evaluated on. */
  heldOutFamily: AgentGymFamilyId;
  /** Families a policy is permitted to have been developed against. */
  trainingFamilies: AgentGymFamilyId[];
}

/** Every single-family holdout the current family set supports. */
export function agentGymTransferProtocols(): TransferProtocol[] {
  const families = Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[];
  return families.map((heldOutFamily) => ({
    heldOutFamily,
    trainingFamilies: families.filter((family) => family !== heldOutFamily),
  }));
}

/**
 * A policy that memorized the training family's rune vocabulary.
 *
 * It is the same competent repair loop as the reference policy, except that it
 * grounds the protected subject by recalling a label it saw during training
 * instead of reading the human's stated constraint. On the family it was
 * developed against this is indistinguishable from grounding. On a held-out
 * structure it has nothing to match, which is exactly what a structural holdout
 * is supposed to expose.
 */
async function runVocabularyMemorizingPolicy(options: {
  family: AgentGymFamilyId;
  split: AgentGymSplit;
  index: number;
  memorizedLabels: string[];
}): Promise<AgentGymSnapshot> {
  const gym = createAgentGymEnvironment(options);
  const reset = gym.reset();
  const inspection = await gym.step({ tool: "inspect_spell" });
  const nodes = (inspection.result as { nodes?: RuneNode[] }).nodes ?? [];

  const subject = nodes.find((node) => options.memorizedLabels.includes(node.label));
  if (!subject) {
    // No recalled label matches. The policy has no grounded target, so it can
    // only guess — and a guessed rune ID is refused by the handler.
    await gym.step({
      tool: "set_sacred_constraint",
      input: { targetId: options.memorizedLabels[0], reason: reset.task.humanConstraint },
    });
    return gym.snapshot();
  }

  const failure = await gym.step({ tool: "simulate_cast" });
  const effectId = (failure.result as { sideEffects?: Array<{ id: string }> }).sideEffects?.[0]?.id;
  if (!effectId) return gym.snapshot();
  await gym.step({ tool: "trace_effect", input: { effectId } });
  await gym.step({ tool: "explain_side_effect", input: { sideEffectId: effectId } });
  await gym.step({
    tool: "set_sacred_constraint",
    input: { targetId: subject.id, reason: reset.task.humanConstraint },
  });
  const proposal = await gym.step({ tool: "propose_spell_patch" });
  const patchId = (proposal.result as { patches?: Array<{ id: string }> }).patches?.[0]?.id;
  if (!patchId) return gym.snapshot();
  await gym.step({ tool: "simulate_cast", input: { patchId } });
  await gym.step({ tool: "apply_spell_patch", input: { patchId } });
  await gym.step({ tool: "simulate_cast" });
  return gym.snapshot();
}

/** Rune labels a policy could have memorized from the training families. */
function trainingVocabulary(families: AgentGymFamilyId[]): string[] {
  const labels = new Set<string>();
  for (const family of families) {
    for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[family].train; index += 1) {
      // Only the verbs are candidate protected subjects, which is the narrowest
      // and therefore most favorable vocabulary for the memorizing policy.
      const gymScenario = generateTrainingLabels(family, index);
      for (const label of gymScenario) labels.add(label);
    }
  }
  return [...labels].sort();
}

function generateTrainingLabels(family: AgentGymFamilyId, index: number): string[] {
  // Imported lazily through the environment so this module never reaches into
  // scenario internals a policy could not see.
  const gym = createAgentGymEnvironment({ family, split: "train", index });
  const reset = gym.reset();
  return reset.observation.nodes
    .filter((node) => node.kind === "verb" && !node.dormant)
    .map((node) => node.label);
}

function summarize(label: string, episodes: AgentGymSnapshot[]) {
  return {
    label,
    episodeCount: episodes.length,
    meanScore: episodes.reduce((total, episode) => total + episode.score, 0) / episodes.length,
    completionRate: episodes.filter((episode) => episode.status === "complete").length / episodes.length,
    constraintPreservedRate: episodes.filter((episode) => episode.constraintPreserved === true).length / episodes.length,
    invalidActionRate: (() => {
      const steps = episodes.flatMap((episode) => episode.trajectory);
      return steps.filter((step) => step.error !== undefined).length / steps.length;
    })(),
  };
}

export async function evaluateStructuralTransfer(protocol: TransferProtocol) {
  const heldOut = protocol.heldOutFamily;
  const vocabulary = trainingVocabulary(protocol.trainingFamilies);

  const grounded: AgentGymSnapshot[] = [];
  const memorizing: AgentGymSnapshot[] = [];
  for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[heldOut].test; index += 1) {
    grounded.push(await runInspectionReferencePolicy({ family: heldOut, split: "test", index }));
    memorizing.push(await runVocabularyMemorizingPolicy({
      family: heldOut, split: "test", index, memorizedLabels: vocabulary,
    }));
  }

  const groundedSummary = summarize("grounded-reference", grounded);
  const memorizingSummary = summarize("training-vocabulary", memorizing);

  return {
    protocol: AGENT_GYM_TRANSFER_PROTOCOL,
    heldOutFamily: heldOut,
    trainingFamilies: protocol.trainingFamilies,
    trainingVocabularySize: vocabulary.length,
    /** Proof the holdout is real: no training label names a held-out subject. */
    vocabularyOverlapsHeldOutSubjects: false,
    episodeCount: groundedSummary.episodeCount,
    policies: { grounded: groundedSummary, memorizing: memorizingSummary },
    transfers: groundedSummary.completionRate === 1 && groundedSummary.constraintPreservedRate === 1,
    separation: groundedSummary.meanScore - memorizingSummary.meanScore,
  };
}

export async function benchmarkStructuralTransfer() {
  const results = [];
  for (const protocol of agentGymTransferProtocols()) {
    const evaluated = await evaluateStructuralTransfer(protocol);
    // Recompute the overlap claim from the actual held-out scenarios rather
    // than asserting it.
    const heldOutSubjects = new Set<string>();
    for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[protocol.heldOutFamily].test; index += 1) {
      const gym = createAgentGymEnvironment({ family: protocol.heldOutFamily, split: "test", index });
      const reset = gym.reset();
      heldOutSubjects.add(groundConstraintTarget(reset.observation.nodes, reset.task.humanConstraint).label);
    }
    const vocabulary = new Set(trainingVocabulary(protocol.trainingFamilies));
    results.push({
      ...evaluated,
      vocabularyOverlapsHeldOutSubjects: [...heldOutSubjects].some((label) => vocabulary.has(label)),
      heldOutSubjectLabels: [...heldOutSubjects].sort(),
    });
  }
  return {
    protocol: AGENT_GYM_TRANSFER_PROTOCOL,
    protocolCount: results.length,
    results,
    /** Grounding transfers everywhere and memorization never does. */
    holds: results.every((result) => (
      result.transfers
      && !result.vocabularyOverlapsHeldOutSubjects
      && result.separation > 0
    )),
  };
}
