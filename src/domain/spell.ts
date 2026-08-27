export type RuneKind =
  | "source"
  | "verb"
  | "target"
  | "modifier"
  | "condition"
  | "constraint"
  | "sink";

export type SpellEdgeType =
  | "flows_to"
  | "targets"
  | "modifies"
  | "triggers"
  | "excepts"
  | "requires"
  | "cancels";

export interface RuneNode {
  id: string;
  kind: RuneKind;
  label: string;
  glyph: string;
  description: string;
  x: number;
  y: number;
  dormant?: boolean;
}

export interface SpellEdge {
  id: string;
  from: string;
  to: string;
  type: SpellEdgeType;
}

export interface SacredConstraint {
  id: string;
  targetId: string;
  targetType: "node" | "edge" | "effect" | "outcome";
  requirement: "preserve" | "avoid" | "limit";
  reason: string;
}

export interface SpellGraph {
  id: string;
  version: number;
  scenario: string;
  seed: number;
  desiredOutcome: string;
  nodes: RuneNode[];
  edges: SpellEdge[];
  constraints: SacredConstraint[];
}

export type PatchOperation =
  | { op: "add_edge"; edge: SpellEdge }
  | { op: "remove_edge"; edgeId: string }
  | { op: "activate_node"; nodeId: string };

export interface SpellPatch {
  id: string;
  title: string;
  rationale: string;
  expectedVersion: number;
  operations: PatchOperation[];
  preserves: string[];
  tradeoffs: string[];
}

const validConnections: Record<SpellEdgeType, Array<[RuneKind, RuneKind]>> = {
  flows_to: [
    ["source", "modifier"],
    ["source", "verb"],
    ["modifier", "verb"],
    ["modifier", "modifier"],
    ["verb", "modifier"],
    ["verb", "verb"],
    ["verb", "sink"],
    ["target", "sink"],
  ],
  targets: [
    ["verb", "target"],
    ["modifier", "target"],
  ],
  modifies: [
    ["modifier", "verb"],
    ["modifier", "source"],
    ["modifier", "target"],
  ],
  triggers: [
    ["condition", "verb"],
    ["target", "verb"],
  ],
  excepts: [["condition", "verb"]],
  requires: [
    ["verb", "condition"],
    ["sink", "condition"],
  ],
  cancels: [
    ["verb", "verb"],
    ["modifier", "modifier"],
  ],
};

export function validateSpellGraph(graph: SpellGraph): string[] {
  const problems: string[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) problems.push(`Duplicate node id: ${node.id}`);
    nodeIds.add(node.id);
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) problems.push(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) {
      problems.push(`Edge ${edge.id} references a missing node`);
      continue;
    }
    const allowed = validConnections[edge.type].some(
      ([fromKind, toKind]) => from.kind === fromKind && to.kind === toKind,
    );
    if (!allowed) {
      problems.push(
        `Invalid ${edge.type} connection: ${from.kind} -> ${to.kind}`,
      );
    }
  }

  for (const constraint of graph.constraints) {
    if (constraint.targetType === "node" && !nodeIds.has(constraint.targetId)) {
      problems.push(`Constraint ${constraint.id} references a missing node`);
    }
    if (constraint.targetType === "edge" && !edgeIds.has(constraint.targetId)) {
      problems.push(`Constraint ${constraint.id} references a missing edge`);
    }
  }

  return problems;
}

export function cloneGraph(graph: SpellGraph): SpellGraph {
  return JSON.parse(JSON.stringify(graph)) as SpellGraph;
}

export function serializeSpellGraph(graph: SpellGraph): string {
  return JSON.stringify({
    ...graph,
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
    constraints: [...graph.constraints].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  });
}

export function applyPatch(graph: SpellGraph, patch: SpellPatch): SpellGraph {
  if (patch.expectedVersion !== graph.version) {
    throw new Error(
      `Stale patch: expected graph v${patch.expectedVersion}, received v${graph.version}`,
    );
  }

  const next = cloneGraph(graph);
  for (const operation of patch.operations) {
    if (operation.op === "remove_edge") {
      next.edges = next.edges.filter((edge) => edge.id !== operation.edgeId);
    } else if (operation.op === "add_edge") {
      if (!next.edges.some((edge) => edge.id === operation.edge.id)) {
        next.edges.push(operation.edge);
      }
    } else if (operation.op === "activate_node") {
      const node = next.nodes.find((candidate) => candidate.id === operation.nodeId);
      if (!node) throw new Error(`Cannot activate missing node: ${operation.nodeId}`);
      node.dormant = false;
    }
  }
  next.version += 1;
  const problems = validateSpellGraph(next);
  if (problems.length) throw new Error(`Invalid patch: ${problems.join("; ")}`);
  return next;
}
