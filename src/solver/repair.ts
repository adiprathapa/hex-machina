import {
  applyPatch,
  cloneGraph,
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
      subgraph: { graphVersion: graph.version, nodes: [], edges: [] },
      causalSteps: [],
      ruleEvidence: {
        ruleId: "unshielded-water-route-targets-room",
        conclusion: { sideEffectId: "flooded-observatory", observed: false },
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
      nodeIds: ["moonwell", "multiply"],
      edgeIds: ["e-water-multiply"],
    },
    {
      id: "multiplier-creates-twelve-ducks",
      nodeIds: ["multiply", "summon-ducks"],
      edgeIds: ["e-multiply-ducks"],
    },
    {
      id: "ducks-carry-water-to-pour",
      nodeIds: ["summon-ducks", "pour"],
      edgeIds: ["e-ducks-pour"],
    },
    {
      id: "unshielded-pour-targets-room",
      nodeIds: ["pour", "room"],
      edgeIds: ["e-pour-room"],
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
      nodeIds: ["umbrella"],
      edgeIds: [],
      absentConnections: [
        ["summon-ducks", "umbrella"],
        ["moonwell", "umbrella"],
        ["umbrella", "pour"],
      ],
      satisfied: !(
        (hasConnection("summon-ducks", "umbrella") || hasConnection("moonwell", "umbrella")) &&
        hasConnection("umbrella", "pour")
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

  const rawCandidates: Array<Omit<SpellPatch, "preconditions">> = [
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
