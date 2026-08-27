import type { RuneNode, SpellGraph } from "../domain/spell.ts";
import type { CastResult } from "../simulator/cast.ts";

export const FAMILIAR_MODEL_ID = "moth-message-passing-v1";
export const FAMILIAR_GNN_ENABLED = process.env.NEXT_PUBLIC_FAMILIAR_GNN !== "off";

export interface FamiliarRuneScore {
  nodeId: string;
  label: string;
  probability: number;
  signals: string[];
}

export interface FamiliarPrediction {
  modelId: typeof FAMILIAR_MODEL_ID;
  status: "anomaly" | "stable";
  advisory: true;
  authoritative: false;
  rounds: 2;
  ranking: FamiliarRuneScore[];
}

const inputWeights = {
  responsible: 1.55,
  activated: 0.3,
  modifier: 1.2,
  verb: 0.18,
  dangerousTarget: 0.28,
  outgoing: 0.16,
  sacred: -0.42,
} as const;

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function relu(value: number) {
  return Math.max(0, value);
}

function nodeSignals(
  node: RuneNode,
  responsible: Set<string>,
  activated: Set<string>,
  sacred: Set<string>,
) {
  const signals: string[] = [];
  if (responsible.has(node.id)) signals.push("inside the simulator’s responsible subgraph");
  if (activated.has(node.id)) signals.push("activated during the failed cast");
  if (node.kind === "modifier") signals.push("amplifier-shaped modifier prior");
  if (node.kind === "target" && responsible.has(node.id)) signals.push("receives the unintended terminal effect");
  if (sacred.has(node.id)) signals.push("human constraint reduces removal suspicion");
  return signals;
}

/**
 * Experimental scalar GNN inference.
 *
 * Each active rune receives a frozen feature projection, then exchanges hidden
 * values with its directed neighbors for two rounds. The deterministic cast
 * remains ground truth; this model only ranks where an agent might inspect.
 */
export function inferFamiliar(graph: SpellGraph, cast: CastResult): FamiliarPrediction {
  if (cast.success || cast.sideEffects.length === 0) {
    return {
      modelId: FAMILIAR_MODEL_ID,
      status: "stable",
      advisory: true,
      authoritative: false,
      rounds: 2,
      ranking: [],
    };
  }

  const responsible = new Set(cast.sideEffects.flatMap((effect) => effect.responsibleNodeIds));
  const activated = new Set(cast.events.map((event) => event.nodeId));
  const sacred = new Set(graph.constraints.map((constraint) => constraint.targetId));
  const candidates = graph.nodes.filter(
    (node) => !node.dormant && (responsible.has(node.id) || activated.has(node.id)),
  );

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of candidates) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) continue;
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  let hidden = new Map<string, number>();
  for (const node of candidates) {
    const value =
      (responsible.has(node.id) ? inputWeights.responsible : 0) +
      (activated.has(node.id) ? inputWeights.activated : 0) +
      (node.kind === "modifier" ? inputWeights.modifier : 0) +
      (node.kind === "verb" ? inputWeights.verb : 0) +
      (node.kind === "target" && responsible.has(node.id) ? inputWeights.dangerousTarget : 0) +
      (outgoing.get(node.id)?.length ?? 0) * inputWeights.outgoing +
      (sacred.has(node.id) ? inputWeights.sacred : 0);
    hidden.set(node.id, relu(value));
  }

  for (let round = 0; round < 2; round += 1) {
    const next = new Map<string, number>();
    for (const node of candidates) {
      const self = hidden.get(node.id) ?? 0;
      const predecessorMessage = mean((incoming.get(node.id) ?? []).map((id) => hidden.get(id) ?? 0));
      const successorMessage = mean((outgoing.get(node.id) ?? []).map((id) => hidden.get(id) ?? 0));
      next.set(node.id, relu(self * 0.72 + predecessorMessage * 0.16 + successorMessage * 0.34));
    }
    hidden = next;
  }

  const logits = candidates.map((node) => ({ node, value: hidden.get(node.id) ?? 0 }));
  const maximum = Math.max(...logits.map((item) => item.value));
  const exponentials = logits.map((item) => Math.exp((item.value - maximum) / 0.62));
  const total = exponentials.reduce((sum, value) => sum + value, 0);

  const ranking = logits
    .map((item, index) => ({
      nodeId: item.node.id,
      label: item.node.label,
      probability: exponentials[index] / total,
      signals: nodeSignals(item.node, responsible, activated, sacred),
    }))
    .sort((left, right) => right.probability - left.probability || left.nodeId.localeCompare(right.nodeId))
    .slice(0, 3);

  return {
    modelId: FAMILIAR_MODEL_ID,
    status: "anomaly",
    advisory: true,
    authoritative: false,
    rounds: 2,
    ranking,
  };
}
