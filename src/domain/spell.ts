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

export interface SpellSemantics {
  effectId: string;
  ruleId: "unshielded-amplified-carrier" | "resonant-feedback-cycle";
  roles: {
    source: string;
    multiplier: string;
    subject: string;
    action: string;
    failureTarget: string;
    safeguard: string;
    goalTarget: string;
    goalSink: string;
  };
  initialRouteEdgeIds: string[];
}

export interface SpellGraph {
  id: string;
  version: number;
  scenario: string;
  seed: number;
  desiredOutcome: string;
  semantics: SpellSemantics;
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
  preconditions: {
    expectedGraphVersion: number;
    requiredEdgeIds: string[];
    requiredDormantNodeIds: string[];
    requiredConstraintIds: string[];
  };
  operations: PatchOperation[];
  preserves: string[];
  tradeoffs: string[];
  searchEvidence: {
    rank: number;
    editCount: number;
    candidateCount: number;
    eligibleCandidateCount: number;
    constraintsSatisfied: string[];
  };
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

export function getValidEdgeTypes(fromKind: RuneKind, toKind: RuneKind): SpellEdgeType[] {
  return (Object.keys(validConnections) as SpellEdgeType[]).filter((edgeType) =>
    validConnections[edgeType].some(
      ([allowedFrom, allowedTo]) => fromKind === allowedFrom && toKind === allowedTo,
    ),
  );
}

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

  for (const [role, nodeId] of Object.entries(graph.semantics.roles)) {
    if (!nodeIds.has(nodeId)) problems.push(`Semantic role ${role} references a missing node: ${nodeId}`);
  }
  if (new Set(Object.values(graph.semantics.roles)).size !== Object.keys(graph.semantics.roles).length) {
    problems.push("Semantic roles must reference distinct nodes");
  }
  if (new Set(graph.semantics.initialRouteEdgeIds).size !== graph.semantics.initialRouteEdgeIds.length) {
    problems.push("Semantic failure route edge IDs must be distinct");
  }

  return problems;
}

export function cloneGraph(graph: SpellGraph): SpellGraph {
  return JSON.parse(JSON.stringify(graph)) as SpellGraph;
}

export function connectRunes(
  graph: SpellGraph,
  fromId: string,
  toId: string,
  edgeType: SpellEdgeType,
): SpellGraph {
  if (fromId === toId) throw new Error("A rune cannot connect to itself");
  const from = graph.nodes.find((node) => node.id === fromId);
  const to = graph.nodes.find((node) => node.id === toId);
  if (!from) throw new Error(`Cannot connect missing rune: ${fromId}`);
  if (!to) throw new Error(`Cannot connect missing rune: ${toId}`);

  const validTypes = getValidEdgeTypes(from.kind, to.kind);
  if (!validTypes.includes(edgeType)) {
    throw new Error(`Invalid ${edgeType} connection: ${from.kind} -> ${to.kind}`);
  }
  if (graph.edges.some((edge) => edge.from === fromId && edge.to === toId && edge.type === edgeType)) {
    throw new Error(`${from.label} is already connected to ${to.label} with ${edgeType}`);
  }

  const next = cloneGraph(graph);
  const edge: SpellEdge = {
    id: `e-manual-v${graph.version}-${fromId}-${edgeType}-${toId}`,
    from: fromId,
    to: toId,
    type: edgeType,
  };
  next.edges.push(edge);
  for (const nodeId of [fromId, toId]) {
    const node = next.nodes.find((candidate) => candidate.id === nodeId);
    if (node) node.dormant = false;
  }
  next.version += 1;

  const problems = validateSpellGraph(next);
  if (problems.length) throw new Error(`Invalid manual edit: ${problems.join("; ")}`);
  return next;
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
  if (patch.preconditions.expectedGraphVersion !== patch.expectedVersion) {
    throw new Error(
      `Patch precondition is inconsistent: expected v${patch.expectedVersion}, preflight requires v${patch.preconditions.expectedGraphVersion}`,
    );
  }
  for (const edgeId of patch.preconditions.requiredEdgeIds) {
    if (!graph.edges.some((edge) => edge.id === edgeId)) {
      throw new Error(`Patch precondition failed: required edge ${edgeId} is missing`);
    }
  }
  for (const nodeId of patch.preconditions.requiredDormantNodeIds) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Patch precondition failed: required rune ${nodeId} is missing`);
    if (!node.dormant) {
      throw new Error(`Patch precondition failed: rune ${nodeId} is no longer dormant`);
    }
  }
  for (const constraintId of patch.preconditions.requiredConstraintIds) {
    if (!graph.constraints.some((constraint) => constraint.id === constraintId)) {
      throw new Error(`Patch precondition failed: sacred constraint ${constraintId} is missing`);
    }
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

  const reachable = new Set(
    next.nodes
      .filter((node) => node.kind === "source" && !node.dormant)
      .map((node) => node.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of next.edges) {
      const destination = next.nodes.find((node) => node.id === edge.to);
      if (reachable.has(edge.from) && destination && !destination.dormant && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        changed = true;
      }
    }
  }

  for (const constraint of graph.constraints) {
    if (constraint.requirement !== "preserve") continue;
    if (constraint.targetType === "node" && !reachable.has(constraint.targetId)) {
      throw new Error(
        `Sacred constraint ${constraint.id} would be violated: ${constraint.targetId} is no longer reachable from a source`,
      );
    }
    if (constraint.targetType === "edge") {
      const sacredEdge = next.edges.find((edge) => edge.id === constraint.targetId);
      if (!sacredEdge || !reachable.has(sacredEdge.from) || !reachable.has(sacredEdge.to)) {
        throw new Error(
          `Sacred constraint ${constraint.id} would be violated: ${constraint.targetId} is no longer on a reachable path`,
        );
      }
    }
  }
  return next;
}
