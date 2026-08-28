import type { SpellGraph, SpellPatch } from "./spell.ts";

export type PatchPreviewKind = "disconnect" | "connect" | "awaken";

export interface PatchPreviewEntry {
  key: string;
  kind: PatchPreviewKind;
  label: string;
  nodeIds: string[];
  edgeId?: string;
  fromId?: string;
  toId?: string;
}

function nodeLabel(graph: SpellGraph, nodeId: string) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Patch preview references missing rune: ${nodeId}`);
  return node.label;
}

function readableEdgeType(edgeType: string) {
  return edgeType.replaceAll("_", " ");
}

/** Converts structural patch operations into a stable, human-reviewable ledger. */
export function buildPatchPreview(graph: SpellGraph, patch: SpellPatch): PatchPreviewEntry[] {
  return patch.operations.map((operation, index) => {
    if (operation.op === "activate_node") {
      return {
        key: `${index}-awaken-${operation.nodeId}`,
        kind: "awaken",
        label: `Awaken ${nodeLabel(graph, operation.nodeId)}`,
        nodeIds: [operation.nodeId],
      };
    }

    if (operation.op === "remove_edge") {
      const edge = graph.edges.find((candidate) => candidate.id === operation.edgeId);
      if (!edge) throw new Error(`Patch preview references missing connection: ${operation.edgeId}`);
      return {
        key: `${index}-disconnect-${edge.id}`,
        kind: "disconnect",
        label: `Disconnect ${nodeLabel(graph, edge.from)} → ${nodeLabel(graph, edge.to)} · ${readableEdgeType(edge.type)}`,
        nodeIds: [edge.from, edge.to],
        edgeId: edge.id,
        fromId: edge.from,
        toId: edge.to,
      };
    }

    const { edge } = operation;
    return {
      key: `${index}-connect-${edge.id}`,
      kind: "connect",
      label: `Connect ${nodeLabel(graph, edge.from)} → ${nodeLabel(graph, edge.to)} · ${readableEdgeType(edge.type)}`,
      nodeIds: [edge.from, edge.to],
      edgeId: edge.id,
      fromId: edge.from,
      toId: edge.to,
    };
  });
}
