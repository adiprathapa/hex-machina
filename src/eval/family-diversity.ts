import { createHash } from "node:crypto";

import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  generateAgentGymScenarioForFamily,
  type AgentGymFamilyId,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";
import type { SpellGraph } from "../domain/spell.ts";

/**
 * What the scenario splits actually hold out.
 *
 * The gym generates variants across disjoint train, validation, and test
 * splits, and they are genuinely disjoint by identifier: no seed, node ID, edge
 * ID, or serialization is shared. It is easy to read that as many distinct
 * tasks, and a held-out score as evidence of generalization.
 *
 * The sharper question is not how many structures exist but whether any
 * structure in the test split is absent from the train split. Fingerprinting
 * each graph on everything except opaque IDs and layout — labels, kinds,
 * glyphs, dormancy, label-level topology, and the role assignment expressed in
 * labels — answers it directly. Adding a second scenario family adds a second
 * structure, but if that family also appears in train, no structure is held
 * out and a test score still measures robustness to identifier and layout
 * perturbation rather than structural generalization.
 *
 * This module computes those numbers so the claim tracks the measurement.
 * `tests/agent-gym-diversity.test.mjs` asserts the scope can never exceed what
 * the numbers support, in both directions.
 */

export const AGENT_GYM_DIVERSITY_PROTOCOL = "hexmend-agent-gym-diversity/v1" as const;

/**
 * What a held-out score is evidence for, chosen by the measurement.
 *
 * `structural` becomes available only once the test split contains a structure
 * that training never saw.
 */
export type HeldOutScope = "identifier-and-layout" | "structural";

function structuralFingerprint(graph: SpellGraph, excludeEdgeIds: readonly string[] = []) {
  const labelOf = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const label = (id: string) => labelOf.get(id) ?? id;
  const dropped = new Set(excludeEdgeIds);
  const edges = graph.edges.filter((edge) => !dropped.has(edge.id));
  // A node is only "awake" for causal purposes if something other than a
  // dropped edge touches it.
  const touched = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  return createHash("sha256").update(JSON.stringify({
    nodes: graph.nodes
      .map((node) => [
        node.label,
        node.kind,
        node.glyph,
        dropped.size > 0 ? !touched.has(node.id) : node.dormant ?? false,
      ])
      .sort(),
    edges: edges.map((edge) => [label(edge.from), edge.type, label(edge.to)]).sort(),
    roles: Object.fromEntries(
      Object.entries(graph.semantics.roles).map(([role, id]) => [role, label(id)]),
    ),
  })).digest("hex").slice(0, 16);
}

/**
 * Diversity under a transfer protocol that withholds one family.
 *
 * The default splits hold out identifiers. A transfer protocol holds out a
 * causal structure, so the same measurement applied to it reports the stronger
 * scope — which is the point of having the measurement drive the claim rather
 * than the other way round. Both sides compare causal fingerprints, so a
 * difference in which benign decoys happen to be active cannot be mistaken for
 * a held-out structure.
 */
export function measureTransferDiversity(
  heldOutFamily: AgentGymFamilyId,
  trainingFamilies: AgentGymFamilyId[],
) {
  const structuresInTraining = new Set<string>();
  for (const family of trainingFamilies) {
    for (const split of ["train", "validation"] as AgentGymSplit[]) {
      for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[family][split]; index += 1) {
        const variant = generateAgentGymScenarioForFamily(family, split, index);
        structuresInTraining.add(structuralFingerprint(variant.graph, variant.decoyEdgeIds));
      }
    }
  }

  const evaluatedStructures = new Set<string>();
  for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[heldOutFamily].test; index += 1) {
    const variant = generateAgentGymScenarioForFamily(heldOutFamily, "test", index);
    evaluatedStructures.add(structuralFingerprint(variant.graph, variant.decoyEdgeIds));
  }

  const unseen = [...evaluatedStructures].filter(
    (fingerprint) => !structuresInTraining.has(fingerprint),
  );
  const heldOutScope: HeldOutScope = unseen.length > 0 ? "structural" : "identifier-and-layout";

  return {
    protocol: AGENT_GYM_DIVERSITY_PROTOCOL,
    mode: "transfer" as const,
    heldOutFamily,
    trainingFamilies,
    structuresInTraining: structuresInTraining.size,
    structuresEvaluated: evaluatedStructures.size,
    evaluatedStructuresUnseenInTraining: unseen.length,
    heldOutScope,
    supportedClaim: unseen.length > 0
      ? `Scores under this protocol are evidence of generalization to a graph structure training never contained: ${unseen.length} of ${evaluatedStructures.size} evaluated structures are absent from the training families.`
      : "This protocol withholds no structure, so its scores are evidence of identifier and layout robustness only.",
  };
}

export function measureAgentGymFamilyDiversity() {
  const families = Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[];
  const splits = ["train", "validation", "test"] as AgentGymSplit[];

  const structuresBySplit: Record<AgentGymSplit, Set<string>> = {
    train: new Set(), validation: new Set(), test: new Set(),
  };
  const causalBySplit: Record<AgentGymSplit, Set<string>> = {
    train: new Set(), validation: new Set(), test: new Set(),
  };
  const allStructures = new Set<string>();
  const objectives = new Map<string, Set<AgentGymSplit>>();
  const identifiers = new Map<string, number>();
  const seeds = new Set<number>();
  let scenarioCount = 0;

  for (const family of families) {
    for (const split of splits) {
      for (let index = 0; index < AGENT_GYM_FAMILY_SPLIT_SIZES[family][split]; index += 1) {
        const variant = generateAgentGymScenarioForFamily(family, split, index);
        scenarioCount += 1;
        seeds.add(variant.seed);

        const fingerprint = structuralFingerprint(variant.graph);
        structuresBySplit[split].add(fingerprint);
        allStructures.add(fingerprint);

        // Two variants that differ only by which benign decoys are active have
        // the same causal problem. Counting that difference as a held-out
        // structure once promoted the whole claim on a single accident.
        causalBySplit[split].add(structuralFingerprint(variant.graph, variant.decoyEdgeIds));

        const seen = objectives.get(variant.objective) ?? new Set<AgentGymSplit>();
        seen.add(split);
        objectives.set(variant.objective, seen);

        for (const id of [
          ...variant.graph.nodes.map((node) => node.id),
          ...variant.graph.edges.map((edge) => edge.id),
        ]) {
          identifiers.set(id, (identifiers.get(id) ?? 0) + 1);
        }
      }
    }
  }

  const unseenInTraining = [...structuresBySplit.test].filter(
    (fingerprint) => !structuresBySplit.train.has(fingerprint),
  );
  const causalUnseenInTraining = [...causalBySplit.test].filter(
    (fingerprint) => !causalBySplit.train.has(fingerprint),
  );
  // The scope has to rest on causal novelty. A test task whose only novelty is
  // its seeded decoy subgraph is a different picture of the same problem, and
  // held-out scores on it are not structural-generalization evidence.
  const heldOutScope: HeldOutScope = causalUnseenInTraining.length > 0
    ? "structural"
    : "identifier-and-layout";

  return {
    protocol: AGENT_GYM_DIVERSITY_PROTOCOL,
    familyIds: families,
    scenarioCount,
    identifierDisjoint: {
      distinctSeeds: seeds.size,
      reusedIdentifiers: [...identifiers.values()].filter((count) => count > 1).length,
      holds: seeds.size === scenarioCount
        && [...identifiers.values()].every((count) => count === 1),
    },
    structuralDiversity: {
      distinctStructures: allStructures.size,
      structuresInTrain: structuresBySplit.train.size,
      structuresInTest: structuresBySplit.test.size,
      testStructuresUnseenInTraining: unseenInTraining.length,
      causalStructuresUnseenInTraining: causalUnseenInTraining.length,
    },
    promptDiversity: {
      distinctObjectives: objectives.size,
      objectivesSharedAcrossSplits: [...objectives.values()].filter((seen) => seen.size > 1).length,
    },
    heldOutScope,
    supportedClaim: causalUnseenInTraining.length > 0
      ? "Held-out scores are evidence of generalization to graph structures the training split never contained."
      : "Held-out scores are evidence of robustness to identifier and layout perturbation. They are not evidence of structural generalization: every structure in the test split also appears in training, so no structure is held out.",
  };
}
