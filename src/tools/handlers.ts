import {
  applyPatch,
  cloneGraph,
  type SacredConstraint,
  type SpellGraph,
} from "../domain/spell.ts";
import { simulateCast } from "../simulator/cast.ts";
import { explainFlood, previewPatch, proposePatches } from "../solver/repair.ts";

export interface SpellToolContext {
  getGraph(): SpellGraph;
  setGraph(graph: SpellGraph): void;
  recordActivity(tool: string, detail: string, nodeIds?: string[]): void;
}

function requireNode(graph: SpellGraph, nodeId: string) {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`Unknown rune: ${nodeId}`);
  }
}

function requireShortText(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  if (normalized.length > maximum) {
    throw new Error(`${label} cannot exceed ${maximum} characters`);
  }
  return normalized;
}

export function createSpellToolHandlers(context: SpellToolContext) {
  return {
    inspect_spell: async (input: { nodeIds?: string[] } = {}) => {
      const graph = cloneGraph(context.getGraph());
      if (input.nodeIds && input.nodeIds.length > 20) {
        throw new Error("inspect_spell accepts at most 20 node IDs");
      }
      input.nodeIds?.forEach((nodeId) => requireNode(graph, nodeId));
      const selected = input.nodeIds?.length
        ? graph.nodes.filter((node) => input.nodeIds?.includes(node.id))
        : graph.nodes;
      context.recordActivity("inspect_spell", `Inspected spell v${graph.version}.`, selected.map((node) => node.id));
      return { ...graph, nodes: selected };
    },
    trace_effect: async (input: { effectId?: string } = {}) => {
      const explanation = explainFlood(context.getGraph());
      context.recordActivity("trace_effect", `Traced ${input.effectId ?? "the active failure"}.`, explanation.nodeIds);
      return explanation;
    },
    simulate_cast: async () => {
      const result = simulateCast(context.getGraph());
      context.recordActivity("simulate_cast", result.summary, result.events.map((event) => event.nodeId));
      return result;
    },
    explain_side_effect: async (input: { sideEffectId: string }) => {
      if (input.sideEffectId !== "flooded-observatory") {
        throw new Error(`Unknown side effect: ${input.sideEffectId}`);
      }
      const explanation = explainFlood(context.getGraph());
      context.recordActivity("explain_side_effect", explanation.explanation, explanation.nodeIds);
      return { requestedId: input.sideEffectId, ...explanation };
    },
    set_sacred_constraint: async (input: {
      targetId: string;
      reason: string;
      preserve?: boolean;
    }) => {
      const before = context.getGraph();
      requireNode(before, input.targetId);
      const reason = requireShortText(input.reason, "Constraint reason", 180);
      const next = cloneGraph(before);
      const id = `sacred-${input.targetId}`;
      const existing = next.constraints.findIndex((item) => item.id === id);
      if (input.preserve === false) {
        next.constraints = next.constraints.filter((item) => item.id !== id);
      } else {
        const constraint: SacredConstraint = {
          id,
          targetId: input.targetId,
          targetType: "node",
          requirement: "preserve",
          reason,
        };
        if (existing >= 0) next.constraints[existing] = constraint;
        else next.constraints.push(constraint);
      }
      next.version += 1;
      context.setGraph(next);
      context.recordActivity("set_sacred_constraint", input.preserve === false ? `Released ${input.targetId}.` : `Protected ${input.targetId}: ${reason}`, [input.targetId]);
      return { graphVersion: next.version, before: before.constraints, after: next.constraints };
    },
    propose_spell_patch: async () => {
      const graph = context.getGraph();
      const patches = proposePatches(graph).map((patch) => {
        let predictedOutcome = null;
        try {
          predictedOutcome = previewPatch(graph, patch).simulation;
        } catch {
          predictedOutcome = null;
        }
        return { ...patch, predictedOutcome };
      });
      context.recordActivity("propose_spell_patch", patches.length ? `Prepared ${patches.length} constraint-aware patch.` : "No patch is needed.");
      return { graphVersion: graph.version, patches };
    },
    apply_spell_patch: async (input: { patchId: string }) => {
      const before = context.getGraph();
      const patch = proposePatches(before).find((candidate) => candidate.id === input.patchId);
      if (!patch) {
        throw new Error(
          `Patch ${input.patchId} is unavailable or stale for graph v${before.version}`,
        );
      }
      const next = applyPatch(before, patch);
      context.setGraph(next);
      const verification = simulateCast(next);
      context.recordActivity("apply_spell_patch", `Applied ${patch.title}. ${verification.summary}`, patch.operations.flatMap((operation) => operation.op === "add_edge" ? [operation.edge.from, operation.edge.to] : operation.op === "activate_node" ? [operation.nodeId] : []));
      return {
        before: { version: before.version, edgeCount: before.edges.length },
        after: { version: next.version, edgeCount: next.edges.length },
        verification,
      };
    },
  };
}

export type SpellToolHandlers = ReturnType<typeof createSpellToolHandlers>;
