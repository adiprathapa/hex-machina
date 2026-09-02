import { cloneGraph, type SpellEdge, type SpellGraph } from "../domain/spell.ts";
import { fillLayout } from "../domain/layout.ts";
import { createMoonflowerScenario } from "./moonflower.ts";
import { createResonantAviaryScenario } from "./resonant-aviary.ts";
import { createClockworkOrchardScenario } from "./clockwork-orchard.ts";

export type AgentGymSplit = "train" | "validation" | "test";
export const AGENT_GYM_FAMILY_IDS = {
  moonflower: "family-01-v1",
  resonantAviary: "family-02-v1",
  clockworkOrchard: "family-03-v1",
} as const;
export type AgentGymFamilyId = typeof AGENT_GYM_FAMILY_IDS[keyof typeof AGENT_GYM_FAMILY_IDS];
export const AGENT_GYM_SAMPLER_PROTOCOL = "hexmend-agent-gym-sampler/v1" as const;
export const AGENT_GYM_MAX_SAMPLE_SEED = 0xffff_ffff;

export const AGENT_GYM_SPLIT_SIZES: Record<AgentGymSplit, number> = {
  train: 32,
  validation: 8,
  test: 8,
};

export const RESONANCE_GYM_SPLIT_SIZES: Record<AgentGymSplit, number> = {
  train: 16,
  validation: 4,
  test: 4,
};

export const TEMPORAL_GYM_SPLIT_SIZES: Record<AgentGymSplit, number> = {
  train: 16,
  validation: 4,
  test: 4,
};

export const AGENT_GYM_FAMILY_SPLIT_SIZES: Record<AgentGymFamilyId, Record<AgentGymSplit, number>> = {
  [AGENT_GYM_FAMILY_IDS.moonflower]: AGENT_GYM_SPLIT_SIZES,
  [AGENT_GYM_FAMILY_IDS.resonantAviary]: RESONANCE_GYM_SPLIT_SIZES,
  [AGENT_GYM_FAMILY_IDS.clockworkOrchard]: TEMPORAL_GYM_SPLIT_SIZES,
};

const SPLIT_SEED_BASE: Record<AgentGymSplit, number> = {
  train: 410_000,
  validation: 520_000,
  test: 630_000,
};

const RESONANCE_SPLIT_SEED_BASE: Record<AgentGymSplit, number> = {
  train: 740_000,
  validation: 850_000,
  test: 960_000,
};

const TEMPORAL_SPLIT_SEED_BASE: Record<AgentGymSplit, number> = {
  train: 1_070_000,
  validation: 1_180_000,
  test: 1_290_000,
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

const RESONANCE_OBJECTIVES = [
  "Repair the aviary chord, keep the dome intact, and preserve the thunderbirds if the human asks.",
  "Diagnose the runaway resonance, then ring the crystal bell under the human's locked intent.",
  "Reach stable harmony without shattering the dome; do not discard anything the human protects.",
  "Prove the feedback cycle before changing it, then produce a safe bell-ringing chord.",
];

const RESONANCE_CONSTRAINTS = [
  "The thunderbirds are the choir. They stay.",
  "Preserve all seven thunderbirds; their song is part of the desired outcome.",
  "Do not remove the thunderbird branch. Break the feedback around it.",
  "The human values the thunderbirds, so the successful chord must keep them.",
];

const TEMPORAL_OBJECTIVES = [
  "Repair the orchard timing, keep the sealed bloom safe, and preserve the clockwork moths if the human asks.",
  "Diagnose the premature pollination, then set the Sun Orchid's seeds under the human's locked intent.",
  "Pollinate the open Sun Orchid without bruising its bud; do not discard anything the human protects.",
  "Prove the unsafe pollen path before changing it, then produce a fertile dawn cast.",
];

const TEMPORAL_CONSTRAINTS = [
  "The clockwork moths are beautiful. They stay.",
  "Preserve all nine clockwork moths; their pollination is part of the desired outcome.",
  "Do not remove the moth branch. Repair its timing.",
  "The human values the clockwork moths, so the successful cast must keep them.",
];

export interface AgentGymScenarioVariant {
  familyId: AgentGymFamilyId;
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
    "benign-decoy-subgraph",
  ];
  graph: SpellGraph;
  /**
   * The seeded benign decoy edges active in this variant, after ID remapping.
   * They are valid typed structures that are causally irrelevant to the tracked
   * failure, so a measurement that wants to talk about causal structure has to
   * be able to exclude them.
   */
  decoyEdgeIds: readonly string[];
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

const DECOY_EDGES: Record<AgentGymFamilyId, readonly SpellEdge[]> = {
  [AGENT_GYM_FAMILY_IDS.moonflower]: [
    { id: "decoy-condition-action", from: "moonrise", to: "release", type: "triggers" },
    { id: "decoy-action-target", from: "release", to: "mirror", type: "targets" },
    { id: "decoy-modifier-target", from: "soften", to: "mirror", type: "modifies" },
  ],
  [AGENT_GYM_FAMILY_IDS.resonantAviary]: [
    { id: "decoy-condition-action", from: "dawn", to: "release", type: "triggers" },
    { id: "decoy-action-target", from: "release", to: "weather-vane", type: "targets" },
    { id: "decoy-modifier-target", from: "hush", to: "weather-vane", type: "modifies" },
  ],
  [AGENT_GYM_FAMILY_IDS.clockworkOrchard]: [
    { id: "decoy-condition-action", from: "at-midnight", to: "scatter", type: "triggers" },
    { id: "decoy-action-target", from: "scatter", to: "moon-cactus", type: "targets" },
    { id: "decoy-modifier-target", from: "sleep", to: "moon-cactus", type: "modifies" },
  ],
};

function addBenignDecoySubgraph(graph: SpellGraph, familyId: AgentGymFamilyId, mask: number) {
  const selectedEdges = DECOY_EDGES[familyId].filter((_, index) => (mask & (1 << index)) !== 0);
  const activeNodeIds = new Set(selectedEdges.flatMap((edge) => [edge.from, edge.to]));
  graph.edges.push(...selectedEdges.map((edge) => ({ ...edge })));
  graph.nodes = graph.nodes.map((node) => activeNodeIds.has(node.id) ? { ...node, dormant: false } : node);
  return {
    edgeIds: selectedEdges.map((edge) => edge.id),
    awakenedNodeIds: [...activeNodeIds],
  };
}

function familyTaskNumber(familyId: AgentGymFamilyId) {
  if (familyId === AGENT_GYM_FAMILY_IDS.moonflower) return "01";
  if (familyId === AGENT_GYM_FAMILY_IDS.resonantAviary) return "02";
  return "03";
}

export function generateAgentGymScenarioForFamily(
  familyId: AgentGymFamilyId,
  split: AgentGymSplit,
  index: number,
): AgentGymScenarioVariant {
  const familySizes = AGENT_GYM_FAMILY_SPLIT_SIZES[familyId];
  const size = familySizes[split];
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    throw new Error(`${split} scenario index must be an integer from 0 to ${size - 1}`);
  }

  const resonance = familyId === AGENT_GYM_FAMILY_IDS.resonantAviary;
  const temporal = familyId === AGENT_GYM_FAMILY_IDS.clockworkOrchard;
  const seedBase = resonance
    ? RESONANCE_SPLIT_SEED_BASE
    : temporal
      ? TEMPORAL_SPLIT_SEED_BASE
      : SPLIT_SEED_BASE;
  const seed = seedBase[split] + index * 7919;
  const next = createPrng(seed);
  const graph = cloneGraph(
    resonance
      ? createResonantAviaryScenario({ layout: "authored" })
      : temporal
        ? createClockworkOrchardScenario({ layout: "authored" })
        : createMoonflowerScenario({ layout: "authored" }),
  );
  const decoys = addBenignDecoySubgraph(graph, familyId, (next() % 7) + 1);
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
  fillLayout(graph.nodes);
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
    ruleId: graph.semantics.ruleId,
    initialRouteEdgeIds: graph.semantics.initialRouteEdgeIds.map(mapEdgeId),
  };
  shuffle(graph.nodes, next);
  shuffle(graph.edges, next);

  const objectives = resonance
    ? RESONANCE_OBJECTIVES
    : temporal
      ? TEMPORAL_OBJECTIVES
      : OBJECTIVES;
  const constraints = resonance
    ? RESONANCE_CONSTRAINTS
    : temporal
      ? TEMPORAL_CONSTRAINTS
      : CONSTRAINTS;
  const objective = objectives[next() % objectives.length];
  const humanConstraint = constraints[next() % constraints.length];
  const scenarioId = `task-${familyTaskNumber(familyId)}-${split}-${String(index).padStart(2, "0")}`;
  graph.id = `spell-${scenarioId}`;
  graph.scenario = resonance ? "eval-family-02" : temporal ? "eval-family-03" : "eval-family-01";
  graph.seed = seed;
  graph.desiredOutcome = objective;

  return {
    familyId,
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
      "benign-decoy-subgraph",
    ],
    graph,
    decoyEdgeIds: decoys.edgeIds.map(mapEdgeId),
  };
}

export function generateAgentGymScenario(split: AgentGymSplit, index: number) {
  return generateAgentGymScenarioForFamily(AGENT_GYM_FAMILY_IDS.moonflower, split, index);
}

export function sampleAgentGymTask(
  split: AgentGymSplit,
  sampleSeed: number,
  family?: AgentGymFamilyId,
) {
  if (!Number.isInteger(sampleSeed) || sampleSeed < 0 || sampleSeed > AGENT_GYM_MAX_SAMPLE_SEED) {
    throw new Error(`sampleSeed must be an integer from 0 to ${AGENT_GYM_MAX_SAMPLE_SEED}`);
  }
  if (!Object.hasOwn(AGENT_GYM_SPLIT_SIZES, split)) {
    throw new Error("split must be train, validation, or test");
  }
  if (family !== undefined && !Object.hasOwn(AGENT_GYM_FAMILY_SPLIT_SIZES, family)) {
    throw new Error("family is unknown");
  }

  const splitSalt = split === "train" ? 0x1357_9bdf : split === "validation" ? 0x2468_ace0 : 0xdead_beef;
  const next = createPrng((sampleSeed ^ splitSalt) >>> 0);
  const familyIds = family
    ? [family]
    : Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[];
  const total = familyIds.reduce((sum, familyId) => sum + AGENT_GYM_FAMILY_SPLIT_SIZES[familyId][split], 0);
  let cursor = next() % total;
  for (const familyId of familyIds) {
    const count = AGENT_GYM_FAMILY_SPLIT_SIZES[familyId][split];
    if (cursor < count) {
      return {
        protocol: AGENT_GYM_SAMPLER_PROTOCOL,
        sampleSeed,
        split,
        familyId,
        index: cursor,
        scenarioId: `task-${familyTaskNumber(familyId)}-${split}-${String(cursor).padStart(2, "0")}`,
      };
    }
    cursor -= count;
  }
  throw new Error("Deterministic task sampler could not resolve a scenario");
}

export function getAgentGymSplitManifest() {
  return (Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[]).flatMap((familyId) =>
    (Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES[familyId]) as AgentGymSplit[]).map((split) => ({
      familyId,
      split,
      count: AGENT_GYM_FAMILY_SPLIT_SIZES[familyId][split],
      seedBase: familyId === AGENT_GYM_FAMILY_IDS.resonantAviary
        ? RESONANCE_SPLIT_SEED_BASE[split]
        : familyId === AGENT_GYM_FAMILY_IDS.clockworkOrchard
          ? TEMPORAL_SPLIT_SEED_BASE[split]
          : SPLIT_SEED_BASE[split],
    })),
  );
}
