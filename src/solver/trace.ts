import { validateSpellGraph, type SpellEdge, type SpellGraph } from "../domain/spell.ts";
import { simulateCast } from "../simulator/cast.ts";

export const MAX_TRACE_DEPTH = 12;
export const MAX_TRACE_PATHS = 5;

export interface TraceOptions {
  effectId?: string;
  sourceId?: string;
  maxDepth: number;
  maxPaths: number;
}

interface CausalPath {
  pathIndex: number;
  nodeIds: string[];
  edgeIds: string[];
  depth: number;
  terminalNodeId: string;
  complete: boolean;
}

interface CycleEvidence {
  nodeIds: string[];
  edgeIds: string[];
}

function activeEdges(graph: SpellGraph) {
  const active = new Set(graph.nodes.filter((node) => !node.dormant).map((node) => node.id));
  return graph.edges
    .filter((edge) => active.has(edge.from) && active.has(edge.to))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

/**
 * Walks the executable graph without mutating it. Results are deterministically
 * ordered and bounded so an agent cannot accidentally request an unbounded trace.
 */
export function traceSpellGraph(graph: SpellGraph, options: TraceOptions) {
  const cast = simulateCast(graph);
  const effect = options.effectId
    ? cast.sideEffects.find((candidate) => candidate.id === options.effectId)
    : undefined;
  const query = options.sourceId
    ? { kind: "source" as const, id: options.sourceId }
    : { kind: "effect" as const, id: options.effectId ?? "flooded-observatory" };

  if (query.kind === "effect" && !effect) {
    return {
      graphVersion: graph.version,
      query,
      present: false,
      paths: [] as CausalPath[],
      responsibleNodeIds: [] as string[],
      responsibleEdgeIds: [] as string[],
      cycles: [] as CycleEvidence[],
      typeViolations: validateSpellGraph(graph),
      bounds: { maxDepth: options.maxDepth, maxPaths: options.maxPaths },
      truncated: false,
    };
  }

  const allowedEdgeIds = effect ? new Set(effect.responsibleEdgeIds) : null;
  const edges = activeEdges(graph).filter((edge) => !allowedEdgeIds || allowedEdgeIds.has(edge.id));
  const outgoing = new Map<string, SpellEdge[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const startId = options.sourceId ?? effect!.responsibleNodeIds[0];
  const targetId = effect?.responsibleNodeIds.at(-1);
  const paths: CausalPath[] = [];
  const cycles: CycleEvidence[] = [];
  const cycleKeys = new Set<string>();
  let truncated = false;

  const addPath = (nodeIds: string[], edgeIds: string[], complete: boolean) => {
    if (paths.length >= options.maxPaths) {
      truncated = true;
      return;
    }
    paths.push({
      pathIndex: paths.length + 1,
      nodeIds,
      edgeIds,
      depth: edgeIds.length,
      terminalNodeId: nodeIds.at(-1)!,
      complete,
    });
  };

  const walk = (nodeId: string, nodeIds: string[], edgeIds: string[]) => {
    if (paths.length >= options.maxPaths) {
      truncated = true;
      return;
    }
    const nextEdges = outgoing.get(nodeId) ?? [];
    if (targetId && nodeId === targetId) {
      addPath(nodeIds, edgeIds, true);
      return;
    }
    if (edgeIds.length >= options.maxDepth) {
      addPath(nodeIds, edgeIds, nextEdges.length === 0);
      if (nextEdges.length) truncated = true;
      return;
    }
    if (!nextEdges.length) {
      addPath(nodeIds, edgeIds, !targetId);
      return;
    }

    let traversable = 0;
    for (const edge of nextEdges) {
      const cycleStart = nodeIds.indexOf(edge.to);
      if (cycleStart >= 0) {
        const cycleNodeIds = [...nodeIds.slice(cycleStart), edge.to];
        const cycleEdgeIds = [...edgeIds.slice(cycleStart), edge.id];
        const key = `${cycleNodeIds.join(">")}|${cycleEdgeIds.join(">")}`;
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push({ nodeIds: cycleNodeIds, edgeIds: cycleEdgeIds });
        }
        continue;
      }
      traversable += 1;
      walk(edge.to, [...nodeIds, edge.to], [...edgeIds, edge.id]);
    }
    if (traversable === 0 && cycles.length) addPath(nodeIds, edgeIds, false);
  };

  walk(startId, [startId], []);
  const responsibleNodeIds = unique(paths.flatMap((path) => path.nodeIds));
  const responsibleEdgeIds = unique(paths.flatMap((path) => path.edgeIds));

  return {
    graphVersion: graph.version,
    query,
    present: paths.length > 0,
    paths,
    responsibleNodeIds,
    responsibleEdgeIds,
    cycles,
    typeViolations: validateSpellGraph(graph),
    bounds: { maxDepth: options.maxDepth, maxPaths: options.maxPaths },
    truncated,
  };
}
