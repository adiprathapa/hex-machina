import {
  applyPatch,
  cloneGraph,
  type SacredConstraint,
  type SpellGraph,
} from "../domain/spell.ts";
import { simulateCast } from "../simulator/cast.ts";
import { explainFlood, previewPatch, proposePatches } from "../solver/repair.ts";

export const MAX_INSPECT_NODES = 12;

type ToolInput = Record<string, unknown>;

function requireToolInput(
  input: unknown,
  toolName: string,
  allowedKeys: readonly string[],
): ToolInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${toolName} input must be an object`);
  }
  const record = input as ToolInput;
  const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw new Error(`${toolName} received unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`);
  }
  return record;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

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
    inspect_spell: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "inspect_spell", ["nodeIds"]);
      let nodeIds: string[] | undefined;
      if (parsed.nodeIds !== undefined) {
        if (!Array.isArray(parsed.nodeIds) || parsed.nodeIds.some((nodeId) => typeof nodeId !== "string")) {
          throw new Error("nodeIds must be an array of rune IDs");
        }
        nodeIds = parsed.nodeIds as string[];
        if (nodeIds.length > MAX_INSPECT_NODES) {
          throw new Error(`inspect_spell accepts at most ${MAX_INSPECT_NODES} node IDs`);
        }
        if (new Set(nodeIds).size !== nodeIds.length) {
          throw new Error("inspect_spell node IDs must be unique");
        }
      }
      const graph = cloneGraph(context.getGraph());
      nodeIds?.forEach((nodeId) => requireNode(graph, nodeId));
      const selected = nodeIds?.length
        ? graph.nodes.filter((node) => nodeIds.includes(node.id))
        : graph.nodes;
      context.recordActivity("inspect_spell", `Inspected spell v${graph.version}.`, selected.map((node) => node.id));
      return { ...graph, nodes: selected };
    },
    trace_effect: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "trace_effect", ["effectId"]);
      const effectId = parsed.effectId === undefined
        ? "flooded-observatory"
        : requireString(parsed.effectId, "effectId");
      if (effectId !== "flooded-observatory") {
        throw new Error(`Unknown effect: ${effectId}`);
      }
      const explanation = explainFlood(context.getGraph());
      context.recordActivity("trace_effect", `Traced ${effectId}.`, explanation.nodeIds);
      return explanation;
    },
    simulate_cast: async (input: unknown = {}) => {
      requireToolInput(input, "simulate_cast", []);
      const result = simulateCast(context.getGraph());
      context.recordActivity("simulate_cast", result.summary, result.events.map((event) => event.nodeId));
      return result;
    },
    explain_side_effect: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "explain_side_effect", ["sideEffectId"]);
      const sideEffectId = requireString(parsed.sideEffectId, "sideEffectId");
      if (sideEffectId !== "flooded-observatory") {
        throw new Error(`Unknown side effect: ${sideEffectId}`);
      }
      const explanation = explainFlood(context.getGraph());
      context.recordActivity("explain_side_effect", explanation.explanation, explanation.nodeIds);
      return { requestedId: sideEffectId, ...explanation };
    },
    set_sacred_constraint: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "set_sacred_constraint", ["targetId", "reason", "preserve"]);
      const targetId = requireString(parsed.targetId, "targetId");
      const preserve = parsed.preserve === undefined ? true : parsed.preserve;
      if (typeof preserve !== "boolean") throw new Error("preserve must be a boolean");
      const before = context.getGraph();
      requireNode(before, targetId);
      if (targetId !== "summon-ducks") throw new Error(`Unsupported sacred target: ${targetId}`);
      const reason = requireShortText(requireString(parsed.reason, "reason"), "Constraint reason", 180);
      const next = cloneGraph(before);
      const id = `sacred-${targetId}`;
      const existing = next.constraints.findIndex((item) => item.id === id);
      if (!preserve) {
        next.constraints = next.constraints.filter((item) => item.id !== id);
      } else {
        const constraint: SacredConstraint = {
          id,
          targetId,
          targetType: "node",
          requirement: "preserve",
          reason,
        };
        if (existing >= 0) next.constraints[existing] = constraint;
        else next.constraints.push(constraint);
      }
      next.version += 1;
      context.setGraph(next);
      context.recordActivity("set_sacred_constraint", !preserve ? `Released ${targetId}.` : `Protected ${targetId}: ${reason}`, [targetId]);
      return { graphVersion: next.version, before: before.constraints, after: next.constraints };
    },
    propose_spell_patch: async (input: unknown = {}) => {
      requireToolInput(input, "propose_spell_patch", []);
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
    apply_spell_patch: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "apply_spell_patch", ["patchId"]);
      const patchId = requireString(parsed.patchId, "patchId");
      if (!/^patch-(umbrella|direct)-v[0-9]+$/.test(patchId)) {
        throw new Error(`Invalid patch ID: ${patchId}`);
      }
      const before = context.getGraph();
      const patch = proposePatches(before).find((candidate) => candidate.id === patchId);
      if (!patch) {
        throw new Error(
          `Patch ${patchId} is unavailable or stale for graph v${before.version}`,
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
