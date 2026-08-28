import {
  applyPatch,
  type SpellGraph,
  type SpellPatch,
} from "../domain/spell.ts";
import { simulateCast } from "../simulator/cast.ts";

export function explainFlood(graph: SpellGraph) {
  const result = simulateCast(graph);
  const effect = result.sideEffects.find((item) => item.id === "flooded-observatory");
  if (!effect) {
    return {
      sideEffectId: "flooded-observatory",
      present: false,
      explanation: "The current graph does not produce the observatory flood.",
      nodeIds: [],
      edgeIds: [],
    };
  }
  return {
    sideEffectId: effect.id,
    present: true,
    explanation:
      "Multiply executes before a target is bounded. It amplifies Summon ducks, and Pour still targets the entire room.",
    nodeIds: effect.responsibleNodeIds,
    edgeIds: effect.responsibleEdgeIds,
  };
}

export function proposePatches(graph: SpellGraph): SpellPatch[] {
  if (simulateCast(graph).success) return [];

  const candidates: SpellPatch[] = [
    {
      id: `patch-umbrella-v${graph.version}`,
      title: "Give the ducks umbrellas",
      rationale:
        "Keep the multiplied duck branch intact, route it through Umbrella, narrow Pour to the Moonflower, and explicitly trigger Bloom.",
      expectedVersion: graph.version,
      operations: [
        { op: "remove_edge", edgeId: "e-ducks-pour" },
        { op: "remove_edge", edgeId: "e-pour-room" },
        { op: "activate_node", nodeId: "umbrella" },
        {
          op: "add_edge",
          edge: { id: "e-ducks-umbrella", from: "summon-ducks", to: "umbrella", type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: "e-umbrella-pour", from: "umbrella", to: "pour", type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: "e-pour-flower", from: "pour", to: "moonflower", type: "targets" },
        },
        { op: "activate_node", nodeId: "bloom" },
        {
          op: "add_edge",
          edge: { id: "e-flower-bloom", from: "moonflower", to: "bloom", type: "flows_to" },
        },
      ],
      preserves: ["summon-ducks", "ducks-present"],
      tradeoffs: ["Keeps all twelve ducks", "Activates the dormant Umbrella rune"],
      searchEvidence: {
        rank: 0,
        editCount: 0,
        candidateCount: 0,
        eligibleCandidateCount: 0,
        constraintsSatisfied: [],
      },
    },
    {
      id: `patch-direct-v${graph.version}`,
      title: "Bypass the duck branch",
      rationale: "Disconnect the summon branch from its source and direct Moonwell water to the flower.",
      expectedVersion: graph.version,
      operations: [
        { op: "remove_edge", edgeId: "e-water-multiply" },
        { op: "remove_edge", edgeId: "e-pour-room" },
        {
          op: "add_edge",
          edge: { id: "e-water-pour", from: "moonwell", to: "pour", type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: "e-direct-pour-flower", from: "pour", to: "moonflower", type: "targets" },
        },
        { op: "activate_node", nodeId: "bloom" },
        {
          op: "add_edge",
          edge: { id: "e-direct-flower-bloom", from: "moonflower", to: "bloom", type: "flows_to" },
        },
      ],
      preserves: [],
      tradeoffs: ["The ducks disappear from the spell"],
      searchEvidence: {
        rank: 0,
        editCount: 0,
        candidateCount: 0,
        eligibleCandidateCount: 0,
        constraintsSatisfied: [],
      },
    },
  ];

  const preserveConstraints = graph.constraints.filter((constraint) => constraint.requirement === "preserve");
  const requiredPreserves = preserveConstraints.map((constraint) => constraint.targetId);
  const eligible = candidates.filter((patch) =>
    requiredPreserves.every((targetId) => patch.preserves.includes(targetId)),
  );
  eligible.sort((left, right) =>
    left.operations.length - right.operations.length || left.id.localeCompare(right.id),
  );

  return eligible.map((patch, index) => ({
    ...patch,
    searchEvidence: {
      rank: index + 1,
      editCount: patch.operations.length,
      candidateCount: candidates.length,
      eligibleCandidateCount: eligible.length,
      constraintsSatisfied: preserveConstraints.map((constraint) => constraint.id),
    },
  }));
}

export function previewPatch(graph: SpellGraph, patch: SpellPatch) {
  const next = applyPatch(graph, patch);
  return { graph: next, simulation: simulateCast(next) };
}
