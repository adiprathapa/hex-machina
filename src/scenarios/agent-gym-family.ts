import { cloneGraph, type SpellGraph } from "../domain/spell.ts";
import { createMoonflowerScenario } from "./moonflower.ts";

export type AgentGymSplit = "train" | "validation" | "test";

export const AGENT_GYM_SPLIT_SIZES: Record<AgentGymSplit, number> = {
  train: 32,
  validation: 8,
  test: 8,
};

const SPLIT_SEED_BASE: Record<AgentGymSplit, number> = {
  train: 410_000,
  validation: 520_000,
  test: 630_000,
};

const OBJECTIVES = [
  "Repair the rain spell, keep the observatory dry, and preserve the ducks if the human asks.",
  "Diagnose why the Moonflower stays dry, then find a safe repair that respects the human's constraint.",
  "Make the Moonflower bloom without flooding the room; do not discard anything the human protects.",
  "Prove the failed water path before changing it, then reach a dry-room bloom under locked intent.",
];

const CONSTRAINTS = [
  "The ducks are funny. They stay.",
  "Preserve every summoned duck; their presence is part of the desired outcome.",
  "Do not remove the duck branch. Repair around it.",
  "The human values the ducks, so the successful spell must keep all twelve.",
];

export interface AgentGymScenarioVariant {
  familyId: "moonflower-opaque-roles-v1";
  scenarioId: string;
  split: AgentGymSplit;
  index: number;
  seed: number;
  objective: string;
  humanConstraint: string;
  perturbations: readonly [
    "opaque-node-ids",
    "opaque-edge-ids",
    "stable-order-shuffle",
    "layout-jitter",
    "prompt-paraphrase",
  ];
  graph: SpellGraph;
}

function createPrng(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function shuffle<T>(items: T[], next: () => number) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = next() % (index + 1);
    [items[index], items[target]] = [items[target], items[index]];
  }
}

function opaqueId(prefix: "r" | "e" | "fx", next: () => number, used: Set<string>) {
  let candidate = "";
  do candidate = `${prefix}-${next().toString(36).padStart(7, "0")}`;
  while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

export function generateAgentGymScenario(
  split: AgentGymSplit,
  index: number,
): AgentGymScenarioVariant {
  const size = AGENT_GYM_SPLIT_SIZES[split];
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    throw new Error(`${split} scenario index must be an integer from 0 to ${size - 1}`);
  }

  const seed = SPLIT_SEED_BASE[split] + index * 7919;
  const next = createPrng(seed);
  const graph = cloneGraph(createMoonflowerScenario());
  const used = new Set<string>();
  const nodeIdMap = new Map(graph.nodes.map((node) => [node.id, opaqueId("r", next, used)]));
  const edgeIdMap = new Map(graph.edges.map((edge) => [edge.id, opaqueId("e", next, used)]));
  const mapNodeId = (nodeId: string) => nodeIdMap.get(nodeId) ?? nodeId;
  const mapEdgeId = (edgeId: string) => edgeIdMap.get(edgeId) ?? edgeId;
  const jitter = () => (next() % 11) - 5;

  graph.nodes = graph.nodes.map((node) => ({
    ...node,
    id: mapNodeId(node.id),
    x: Math.min(93, Math.max(7, node.x + jitter())),
    y: Math.min(90, Math.max(7, node.y + jitter())),
  }));
  graph.edges = graph.edges.map((edge) => ({
    ...edge,
    id: mapEdgeId(edge.id),
    from: mapNodeId(edge.from),
    to: mapNodeId(edge.to),
  }));
  graph.semantics = {
    effectId: opaqueId("fx", next, used),
    roles: Object.fromEntries(
      Object.entries(graph.semantics.roles).map(([role, nodeId]) => [role, mapNodeId(nodeId)]),
    ) as SpellGraph["semantics"]["roles"],
    initialRouteEdgeIds: graph.semantics.initialRouteEdgeIds.map(mapEdgeId) as [string, string, string, string],
  };
  shuffle(graph.nodes, next);
  shuffle(graph.edges, next);

  const objective = OBJECTIVES[next() % OBJECTIVES.length];
  const humanConstraint = CONSTRAINTS[next() % CONSTRAINTS.length];
  const scenarioId = `moonflower-${split}-${String(index).padStart(2, "0")}`;
  graph.id = `spell-${scenarioId}`;
  graph.scenario = "moonflower-eval";
  graph.seed = seed;
  graph.desiredOutcome = objective;

  return {
    familyId: "moonflower-opaque-roles-v1",
    scenarioId,
    split,
    index,
    seed,
    objective,
    humanConstraint,
    perturbations: [
      "opaque-node-ids",
      "opaque-edge-ids",
      "stable-order-shuffle",
      "layout-jitter",
      "prompt-paraphrase",
    ],
    graph,
  };
}

export function getAgentGymSplitManifest() {
  return (Object.keys(AGENT_GYM_SPLIT_SIZES) as AgentGymSplit[]).map((split) => ({
    split,
    count: AGENT_GYM_SPLIT_SIZES[split],
    seedBase: SPLIT_SEED_BASE[split],
  }));
}
