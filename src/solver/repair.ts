import {
  applyPatch,
  cloneGraph,
  type SpellGraph,
  type SpellPatch,
} from "../domain/spell.ts";
import { simulateCast } from "../simulator/cast.ts";

export function explainFlood(graph: SpellGraph) {
  const { effectId, roles, initialRouteEdgeIds } = graph.semantics;
  const result = simulateCast(graph);
  const effect = result.sideEffects.find((item) => item.id === effectId);
  if (!effect) {
    return {
      sideEffectId: effectId,
      present: false,
      explanation: "The current graph does not produce the observatory flood.",
      nodeIds: [],
      edgeIds: [],
      subgraph: { graphVersion: graph.version, nodes: [], edges: [] },
      causalSteps: [],
      ruleEvidence: {
        ruleId: "unshielded-water-route-targets-room",
        conclusion: { sideEffectId: effectId, observed: false },
        premises: [],
        allPremisesSatisfied: false,
      },
      minimality: {
        applicable: false,
        complete: true,
        everyResponsibleEdgeNecessary: false,
        necessityChecks: [],
      },
    };
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const responsibleNodes = effect.responsibleNodeIds.flatMap((id) => {
    const node = nodesById.get(id);
    return node ? [node] : [];
  });
  const responsibleEdges = effect.responsibleEdgeIds.flatMap((id) => {
    const edge = edgesById.get(id);
    return edge ? [edge] : [];
  });
  const complete = responsibleNodes.length === effect.responsibleNodeIds.length &&
    responsibleEdges.length === effect.responsibleEdgeIds.length;
  const causalSteps = responsibleEdges.map((edge, index) => {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    return {
      order: index + 1,
      edgeId: edge.id,
      edgeType: edge.type,
      from: { nodeId: edge.from, label: from?.label ?? edge.from },
      to: { nodeId: edge.to, label: to?.label ?? edge.to },
      statement: `${from?.label ?? edge.from} ${edge.type.replace("_", " ")} ${to?.label ?? edge.to}.`,
    };
  });
  const premiseSpecs = [
    {
      id: "water-enters-multiplier",
      nodeIds: [roles.source, roles.multiplier],
      edgeIds: [initialRouteEdgeIds[0]],
    },
    {
      id: "multiplier-creates-twelve-ducks",
      nodeIds: [roles.multiplier, roles.subject],
      edgeIds: [initialRouteEdgeIds[1]],
    },
    {
      id: "ducks-carry-water-to-pour",
      nodeIds: [roles.subject, roles.action],
      edgeIds: [initialRouteEdgeIds[2]],
    },
    {
      id: "unshielded-pour-targets-room",
      nodeIds: [roles.action, roles.failureTarget],
      edgeIds: [initialRouteEdgeIds[3]],
    },
  ];
  const positivePremises = premiseSpecs.map((premise) => ({
    ...premise,
    satisfied: premise.nodeIds.every((id) => nodesById.has(id)) &&
      premise.edgeIds.every((id) => edgesById.has(id)),
  }));
  const hasConnection = (from: string, to: string) =>
    graph.edges.some((edge) => edge.from === from && edge.to === to);
  const premises = [
    ...positivePremises,
    {
      id: "no-protective-umbrella-route",
      nodeIds: [roles.safeguard],
      edgeIds: [],
      absentConnections: [
        [roles.subject, roles.safeguard],
        [roles.source, roles.safeguard],
        [roles.safeguard, roles.action],
      ],
      satisfied: !(
        (hasConnection(roles.subject, roles.safeguard) || hasConnection(roles.source, roles.safeguard)) &&
        hasConnection(roles.safeguard, roles.action)
      ),
    },
  ];
  const necessityChecks = effect.responsibleEdgeIds.map((edgeId) => {
    const candidate = cloneGraph(graph);
    candidate.edges = candidate.edges.filter((edge) => edge.id !== edgeId);
    return {
      removedEdgeId: edgeId,
      sideEffectStillPresent: simulateCast(candidate).sideEffects.some((item) => item.id === effect.id),
    };
  });
  const everyResponsibleEdgeNecessary = complete &&
    necessityChecks.every((check) => !check.sideEffectStillPresent);

  return {
    sideEffectId: effect.id,
    present: true,
    explanation:
      "Multiply executes before a target is bounded. It amplifies Summon ducks, and Pour still targets the entire room.",
    nodeIds: effect.responsibleNodeIds,
    edgeIds: effect.responsibleEdgeIds,
    subgraph: {
      graphVersion: graph.version,
      nodes: responsibleNodes,
      edges: responsibleEdges,
    },
    causalSteps,
    ruleEvidence: {
      ruleId: "unshielded-water-route-targets-room",
      conclusion: { sideEffectId: effect.id, observed: true },
      premises,
      allPremisesSatisfied: premises.every((premise) => premise.satisfied),
    },
    minimality: {
      applicable: true,
      complete,
      nodeCount: responsibleNodes.length,
      edgeCount: responsibleEdges.length,
      omittedNodeCount: graph.nodes.length - responsibleNodes.length,
      omittedEdgeCount: graph.edges.length - responsibleEdges.length,
      everyResponsibleEdgeNecessary,
      necessityChecks,
    },
  };
}

export function proposePatches(graph: SpellGraph): SpellPatch[] {
  if (simulateCast(graph).success) return [];

  const { roles, initialRouteEdgeIds } = graph.semantics;
  const edgeId = (canonical: string, suffix: string) => graph.scenario === "moonflower"
    ? canonical
    : `e-${graph.seed.toString(36)}-${suffix}`;

  const rawCandidates: Array<Omit<SpellPatch, "preconditions">> = [
    {
      id: `patch-umbrella-v${graph.version}`,
      title: "Give the ducks umbrellas",
      rationale:
        "Keep the multiplied duck branch intact, route it through Umbrella, narrow Pour to the Moonflower, and explicitly trigger Bloom.",
      expectedVersion: graph.version,
      operations: [
        { op: "remove_edge", edgeId: initialRouteEdgeIds[2] },
        { op: "remove_edge", edgeId: initialRouteEdgeIds[3] },
        { op: "activate_node", nodeId: roles.safeguard },
        {
          op: "add_edge",
          edge: { id: edgeId("e-ducks-umbrella", "subject-safeguard"), from: roles.subject, to: roles.safeguard, type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: edgeId("e-umbrella-pour", "safeguard-action"), from: roles.safeguard, to: roles.action, type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: edgeId("e-pour-flower", "action-goal"), from: roles.action, to: roles.goalTarget, type: "targets" },
        },
        { op: "activate_node", nodeId: roles.goalSink },
        {
          op: "add_edge",
          edge: { id: edgeId("e-flower-bloom", "goal-sink"), from: roles.goalTarget, to: roles.goalSink, type: "flows_to" },
        },
      ],
      preserves: [roles.subject, "ducks-present"],
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
        { op: "remove_edge", edgeId: initialRouteEdgeIds[0] },
        { op: "remove_edge", edgeId: initialRouteEdgeIds[3] },
        {
          op: "add_edge",
          edge: { id: edgeId("e-water-pour", "source-action"), from: roles.source, to: roles.action, type: "flows_to" },
        },
        {
          op: "add_edge",
          edge: { id: edgeId("e-direct-pour-flower", "direct-action-goal"), from: roles.action, to: roles.goalTarget, type: "targets" },
        },
        { op: "activate_node", nodeId: roles.goalSink },
        {
          op: "add_edge",
          edge: { id: edgeId("e-direct-flower-bloom", "direct-goal-sink"), from: roles.goalTarget, to: roles.goalSink, type: "flows_to" },
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
  const candidates: SpellPatch[] = rawCandidates.map((patch) => ({
    ...patch,
    preconditions: {
      expectedGraphVersion: graph.version,
      requiredEdgeIds: patch.operations.flatMap((operation) => operation.op === "remove_edge" ? [operation.edgeId] : []),
      requiredDormantNodeIds: patch.operations.flatMap((operation) => operation.op === "activate_node" ? [operation.nodeId] : []),
      requiredConstraintIds: preserveConstraints.map((constraint) => constraint.id),
    },
  }));
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
