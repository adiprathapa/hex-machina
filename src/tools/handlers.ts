import {
  applyPatch,
  cloneGraph,
  type SacredConstraint,
  type SpellGraph,
  type SpellPatch,
} from "../domain/spell.ts";
import { simulateCast, type CastResult } from "../simulator/cast.ts";
import { explainFlood, previewPatch, proposePatches } from "../solver/repair.ts";
import { MAX_TRACE_DEPTH, MAX_TRACE_PATHS, traceSpellGraph } from "../solver/trace.ts";

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

function requireBoundedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

export interface SpellToolContext {
  getGraph(): SpellGraph;
  setGraph(graph: SpellGraph): void;
  recordActivity(tool: string, detail: string, nodeIds?: string[]): void;
  presentResult?(event: SpellToolPresentation): void;
}

export type SpellToolPresentation =
  | { tool: "simulate_cast"; simulation: CastResult; previewPatch?: SpellPatch }
  | { tool: "set_sacred_constraint" }
  | { tool: "propose_spell_patch"; patches: SpellPatch[] }
  | {
      tool: "apply_spell_patch";
      verification: CastResult;
      revertToken?: string;
    };

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
  let reversiblePatch: {
    token: string;
    appliedVersion: number;
    graphBeforeApply: SpellGraph;
  } | null = null;

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
      const parsed = requireToolInput(input, "trace_effect", ["effectId", "sourceId", "maxDepth", "maxPaths"]);
      if (parsed.effectId !== undefined && parsed.sourceId !== undefined) {
        throw new Error("trace_effect accepts either effectId or sourceId, not both");
      }
      const effectId = parsed.effectId === undefined
        ? "flooded-observatory"
        : requireString(parsed.effectId, "effectId");
      const sourceId = parsed.sourceId === undefined ? undefined : requireString(parsed.sourceId, "sourceId");
      if (parsed.effectId !== undefined && effectId !== "flooded-observatory") {
        throw new Error(`Unknown effect: ${effectId}`);
      }
      const graph = context.getGraph();
      if (sourceId) {
        requireNode(graph, sourceId);
        const source = graph.nodes.find((node) => node.id === sourceId)!;
        if (source.kind !== "source") throw new Error(`Rune ${sourceId} is not a source`);
      }
      const maxDepth = parsed.maxDepth === undefined
        ? 8
        : requireBoundedInteger(parsed.maxDepth, "maxDepth", 1, MAX_TRACE_DEPTH);
      const maxPaths = parsed.maxPaths === undefined
        ? 3
        : requireBoundedInteger(parsed.maxPaths, "maxPaths", 1, MAX_TRACE_PATHS);
      const trace = traceSpellGraph(graph, {
        effectId: sourceId ? undefined : effectId,
        sourceId,
        maxDepth,
        maxPaths,
      });
      context.recordActivity(
        "trace_effect",
        `Traced ${trace.paths.length} ordered path${trace.paths.length === 1 ? "" : "s"}; ${trace.cycles.length} cycles and ${trace.typeViolations.length} type violations.`,
        trace.responsibleNodeIds,
      );
      return trace;
    },
    simulate_cast: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "simulate_cast", ["patchId"]);
      const graph = context.getGraph();
      if (parsed.patchId !== undefined) {
        const patchId = requireString(parsed.patchId, "patchId");
        if (!/^patch-(umbrella|direct)-v[0-9]+$/.test(patchId)) {
          throw new Error(`Invalid patch ID: ${patchId}`);
        }
        const patch = proposePatches(graph).find((candidate) => candidate.id === patchId);
        if (!patch) {
          throw new Error(`Patch ${patchId} is unavailable or stale for graph v${graph.version}`);
        }
        const result = previewPatch(graph, patch).simulation;
        const nodeIds = patch.operations.flatMap((operation) =>
          operation.op === "add_edge"
            ? [operation.edge.from, operation.edge.to]
            : operation.op === "activate_node"
              ? [operation.nodeId]
              : [],
        );
        context.recordActivity(
          "simulate_cast",
          `Previewed ${patch.title} without changing graph v${graph.version}. ${result.summary}`,
          nodeIds,
        );
        context.presentResult?.({ tool: "simulate_cast", simulation: result, previewPatch: patch });
        return {
          ...result,
          preview: {
            patchId: patch.id,
            baseGraphVersion: graph.version,
            simulatedGraphVersion: result.graphVersion,
            editorMutated: false,
          },
        };
      }

      const result = simulateCast(graph);
      context.recordActivity("simulate_cast", result.summary, result.events.map((event) => event.nodeId));
      context.presentResult?.({ tool: "simulate_cast", simulation: result });
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
      context.presentResult?.({ tool: "set_sacred_constraint" });
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
      context.presentResult?.({ tool: "propose_spell_patch", patches });
      return { graphVersion: graph.version, patches };
    },
    apply_spell_patch: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "apply_spell_patch", ["patchId", "revertToken"]);
      const hasPatchId = parsed.patchId !== undefined;
      const hasRevertToken = parsed.revertToken !== undefined;
      if (hasPatchId === hasRevertToken) {
        throw new Error("apply_spell_patch requires exactly one of patchId or revertToken");
      }

      if (hasRevertToken) {
        const revertToken = requireString(parsed.revertToken, "revertToken");
        if (!/^revert-patch-(umbrella|direct)-v[0-9]+-after-v[0-9]+$/.test(revertToken)) {
          throw new Error("Invalid revert token");
        }
        const current = context.getGraph();
        if (!reversiblePatch || revertToken !== reversiblePatch.token) {
          throw new Error("Revert token is unavailable or has already been used");
        }
        if (current.version !== reversiblePatch.appliedVersion) {
          throw new Error(
            `Revert token is stale for graph v${current.version}; expected v${reversiblePatch.appliedVersion}`,
          );
        }

        const restored = cloneGraph(reversiblePatch.graphBeforeApply);
        restored.version = current.version + 1;
        const beforeSummary = { version: current.version, edgeCount: current.edges.length };
        context.setGraph(restored);
        reversiblePatch = null;
        const verification = simulateCast(restored);
        context.recordActivity(
          "apply_spell_patch",
          `Reverted the agent patch. Spell restored as v${restored.version}.`,
          restored.constraints.map((constraint) => constraint.targetId),
        );
        context.presentResult?.({ tool: "apply_spell_patch", verification });
        return {
          action: "revert" as const,
          reverted: true,
          before: beforeSummary,
          after: { version: restored.version, edgeCount: restored.edges.length },
          verification,
        };
      }

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
      const revertToken = `revert-${patch.id}-after-v${next.version}`;
      reversiblePatch = {
        token: revertToken,
        appliedVersion: next.version,
        graphBeforeApply: cloneGraph(before),
      };
      const verification = simulateCast(next);
      context.recordActivity("apply_spell_patch", `Applied ${patch.title}. ${verification.summary}`, patch.operations.flatMap((operation) => operation.op === "add_edge" ? [operation.edge.from, operation.edge.to] : operation.op === "activate_node" ? [operation.nodeId] : []));
      context.presentResult?.({ tool: "apply_spell_patch", verification, revertToken });
      return {
        action: "apply" as const,
        before: { version: before.version, edgeCount: before.edges.length },
        after: { version: next.version, edgeCount: next.edges.length },
        verification,
        revertToken,
      };
    },
  };
}

export type SpellToolHandlers = ReturnType<typeof createSpellToolHandlers>;
