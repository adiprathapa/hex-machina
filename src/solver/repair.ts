import {
  applyPatch,
  type SacredConstraint,
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

function preserveDucks(constraints: SacredConstraint[]): boolean {
  return constraints.some(
    (constraint) =>
      constraint.requirement === "preserve" &&
      (constraint.targetId === "summon-ducks" || constraint.targetId === "ducks-present"),
  );
}

export function proposePatches(graph: SpellGraph): SpellPatch[] {
  if (simulateCast(graph).success) return [];

  const ducksAreSacred = preserveDucks(graph.constraints);
  if (ducksAreSacred) {
    return [
      {
        id: `patch-umbrella-v${graph.version}`,
        title: "Give the ducks umbrellas",
        rationale:
          "Preserve the summoned ducks, route their water through Umbrella, narrow Pour to the Moonflower, and explicitly trigger Bloom.",
        expectedVersion: graph.version,
        operations: [
          { op: "remove_edge", edgeId: "e-water-multiply" },
          { op: "remove_edge", edgeId: "e-multiply-ducks" },
          { op: "remove_edge", edgeId: "e-ducks-pour" },
          { op: "remove_edge", edgeId: "e-pour-room" },
          {
            op: "add_edge",
            edge: { id: "e-water-ducks", from: "moonwell", to: "summon-ducks", type: "flows_to" },
          },
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
        tradeoffs: ["Produces one duck instead of twelve", "Activates the dormant Umbrella rune"],
      },
    ];
  }

  return [
    {
      id: `patch-direct-v${graph.version}`,
      title: "Remove the duck branch",
      rationale: "Bypass the summon branch and direct Moonwell water to the flower.",
      expectedVersion: graph.version,
      operations: [
        { op: "remove_edge", edgeId: "e-water-multiply" },
        { op: "remove_edge", edgeId: "e-multiply-ducks" },
        { op: "remove_edge", edgeId: "e-ducks-pour" },
        { op: "remove_edge", edgeId: "e-pour-room" },
        {
          op: "add_edge",
          edge: { id: "e-water-pour", from: "moonwell", to: "pour", type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: "e-direct-pour-flower", from: "pour", to: "moonflower", type: "targets" },
        },
        { op: "activate_node", nodeId: "umbrella" },
        {
          op: "add_edge",
          edge: { id: "e-direct-umbrella-pour", from: "umbrella", to: "pour", type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: "e-water-umbrella", from: "moonwell", to: "umbrella", type: "flows_to" },
        },
        { op: "activate_node", nodeId: "bloom" },
        {
          op: "add_edge",
          edge: { id: "e-direct-flower-bloom", from: "moonflower", to: "bloom", type: "flows_to" },
        },
      ],
      preserves: [],
      tradeoffs: ["The ducks disappear from the spell"],
    },
  ];
}

export function previewPatch(graph: SpellGraph, patch: SpellPatch) {
  const next = applyPatch(graph, patch);
  return { graph: next, simulation: simulateCast(next) };
}
