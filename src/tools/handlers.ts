import {
  applyPatch,
  cloneGraph,
  observeSpellGraph,
  type SacredConstraint,
  type SpellGraph,
  type SpellPatch,
} from "../domain/spell.ts";
import { buildPatchPreview, type PatchPreviewEntry } from "../domain/patch-preview.ts";
import { simulateCast, type CastResult } from "../simulator/cast.ts";
import { explainSideEffect, previewPatch, proposePatches } from "../solver/repair.ts";
import { MAX_TRACE_DEPTH, MAX_TRACE_PATHS, traceSpellGraph } from "../solver/trace.ts";
import {
  MAX_INSPECT_NODES,
  SPELL_PATCH_ID_PATTERN,
  SPELL_REVERT_TOKEN_PATTERN,
} from "./definitions.ts";

export { MAX_INSPECT_NODES } from "./definitions.ts";

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

/**
 * Errors an agent can act on.
 *
 * These messages are the only feedback a tool-using model gets when a call is
 * rejected, so each one names the tool it came from — otherwise it is ambiguous
 * under concurrent calls — and distinguishes a missing required field from one
 * of the wrong type, which are different mistakes with different fixes.
 */
function requireString(value: unknown, label: string, tool?: string) {
  const prefix = tool ? `${tool}: ` : "";
  if (value === undefined) {
    throw new Error(`${prefix}${label} is required`);
  }
  if (typeof value !== "string") {
    throw new Error(`${prefix}${label} must be a string, received ${typeof value}`);
  }
  return value;
}

function requireBoundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  tool?: string,
) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(
      `${tool ? `${tool}: ` : ""}${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value as number;
}

export interface SpellToolContext {
  getGraph(): SpellGraph;
  setGraph(graph: SpellGraph): void;
  recordActivity(tool: string, detail: string, nodeIds?: string[]): void;
  presentResult?(event: SpellToolPresentation): void;
}

export interface ReviewedSpellPatch extends SpellPatch {
  predictedOutcome: CastResult | null;
  operationLedger: PatchPreviewEntry[];
  reviewSummary: {
    totalOperations: number;
    disconnectCount: number;
    connectCount: number;
    awakenCount: number;
    touchedNodeIds: string[];
  };
}

export type SpellToolPresentation =
  | { tool: "simulate_cast"; simulation: CastResult; previewPatch?: ReviewedSpellPatch }
  | { tool: "set_sacred_constraint" }
  | { tool: "propose_spell_patch"; patches: ReviewedSpellPatch[] }
  | {
      tool: "apply_spell_patch";
      verification: CastResult;
      revertToken?: string;
    };

function requireNode(graph: SpellGraph, nodeId: string, tool?: string) {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`${tool ? `${tool}: ` : ""}unknown rune ${nodeId}; rune IDs come from inspect_spell`);
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

function createReviewedPatch(
  graph: SpellGraph,
  patch: SpellPatch,
  predictedOutcome: CastResult | null,
): ReviewedSpellPatch {
  const operationLedger = buildPatchPreview(graph, patch);
  return {
    ...patch,
    predictedOutcome,
    operationLedger,
    reviewSummary: {
      totalOperations: operationLedger.length,
      disconnectCount: operationLedger.filter((entry) => entry.kind === "disconnect").length,
      connectCount: operationLedger.filter((entry) => entry.kind === "connect").length,
      awakenCount: operationLedger.filter((entry) => entry.kind === "awaken").length,
      touchedNodeIds: [...new Set(operationLedger.flatMap((entry) => entry.nodeIds))],
    },
  };
}

export function createSpellToolHandlers(context: SpellToolContext) {
  let issuedPatches: { graphVersion: number; patchIds: Set<string> } | null = null;
  let reversiblePatch: {
    token: string;
    appliedVersion: number;
    graphBeforeApply: SpellGraph;
    reviewedPatch: ReviewedSpellPatch;
  } | null = null;

  const requireIssuedPatch = (graph: SpellGraph, patchId: string) => {
    if (issuedPatches?.graphVersion !== graph.version || !issuedPatches.patchIds.has(patchId)) {
      throw new Error(
        `Patch ${patchId} has not been issued for review on graph v${graph.version}; call propose_spell_patch first`,
      );
    }
  };

  return {
    inspect_spell: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "inspect_spell", ["nodeIds"]);
      let nodeIds: string[] | undefined;
      if (parsed.nodeIds !== undefined) {
        if (!Array.isArray(parsed.nodeIds) || parsed.nodeIds.some((nodeId) => typeof nodeId !== "string")) {
          throw new Error("nodeIds must be an array of rune IDs");
        }
        nodeIds = parsed.nodeIds as string[];
        if (nodeIds.length === 0) {
          throw new Error("inspect_spell nodeIds cannot be empty; omit nodeIds to inspect the complete spell");
        }
        if (nodeIds.length > MAX_INSPECT_NODES) {
          throw new Error(`inspect_spell accepts at most ${MAX_INSPECT_NODES} node IDs`);
        }
        if (new Set(nodeIds).size !== nodeIds.length) {
          throw new Error("inspect_spell node IDs must be unique");
        }
      }
      const graph = cloneGraph(context.getGraph());
      const observation = observeSpellGraph(graph);
      nodeIds?.forEach((nodeId) => requireNode(graph, nodeId, "inspect_spell"));
      const selected = nodeIds
        ? graph.nodes.filter((node) => nodeIds.includes(node.id))
        : graph.nodes;
      const selectedIds = new Set(selected.map((node) => node.id));
      const edges = nodeIds
        ? graph.edges.filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
        : graph.edges;
      const boundaryEdges = nodeIds
        ? graph.edges.filter((edge) => selectedIds.has(edge.from) !== selectedIds.has(edge.to))
        : [];
      const simulation = simulateCast(graph);
      const scenarioState = {
        status: simulation.success ? "stable" as const : simulation.sideEffects.length ? "unstable" as const : "incomplete" as const,
        success: simulation.success,
        seed: simulation.seed,
        activeSideEffectIds: simulation.sideEffects.map((effect) => effect.id),
      };
      const filter = {
        applied: Boolean(nodeIds),
        requestedNodeIds: nodeIds ?? [],
        returnedNodeCount: selected.length,
        omittedNodeCount: graph.nodes.length - selected.length,
        internalEdgeCount: edges.length,
        boundaryEdgeCount: boundaryEdges.length,
      };
      context.recordActivity(
        "inspect_spell",
        `Inspected ${selected.length}/${graph.nodes.length} runes in spell v${graph.version}; scenario is ${scenarioState.status}.`,
        selected.map((node) => node.id),
      );
      return {
        ...observation,
        graphVersion: graph.version,
        nodes: selected,
        edges,
        boundaryEdges,
        filter,
        scenarioState,
      };
    },
    trace_effect: async (input: unknown = {}) => {
      const parsed = requireToolInput(input, "trace_effect", ["effectId", "sourceId", "maxDepth", "maxPaths"]);
      if (parsed.effectId !== undefined && parsed.sourceId !== undefined) {
        throw new Error("trace_effect accepts either effectId or sourceId, not both");
      }
      const effectId = parsed.effectId === undefined
        ? context.getGraph().semantics.effectId
        : requireString(parsed.effectId, "effectId", "trace_effect");
      const sourceId = parsed.sourceId === undefined ? undefined : requireString(parsed.sourceId, "sourceId", "trace_effect");
      if (parsed.effectId !== undefined && effectId !== context.getGraph().semantics.effectId) {
        throw new Error(
          `trace_effect: unknown effect ${effectId}; effect IDs come from sideEffects[].id on a prior simulate_cast`,
        );
      }
      const graph = context.getGraph();
      if (sourceId) {
        requireNode(graph, sourceId, "trace_effect");
        const source = graph.nodes.find((node) => node.id === sourceId)!;
        if (source.kind !== "source") throw new Error(`trace_effect: rune ${sourceId} is not a source; sourceId must name a rune whose kind is "source"`);
      }
      const maxDepth = parsed.maxDepth === undefined
        ? 8
        : requireBoundedInteger(parsed.maxDepth, "maxDepth", 1, MAX_TRACE_DEPTH, "trace_effect");
      const maxPaths = parsed.maxPaths === undefined
        ? 3
        : requireBoundedInteger(parsed.maxPaths, "maxPaths", 1, MAX_TRACE_PATHS, "trace_effect");
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
        const patchId = requireString(parsed.patchId, "patchId", "simulate_cast");
        if (!new RegExp(SPELL_PATCH_ID_PATTERN).test(patchId)) {
          throw new Error(`Invalid patch ID: ${patchId}`);
        }
        requireIssuedPatch(graph, patchId);
        const patch = proposePatches(graph).find((candidate) => candidate.id === patchId);
        if (!patch) {
          throw new Error(`Patch ${patchId} is unavailable or stale for graph v${graph.version}`);
        }
        const result = previewPatch(graph, patch).simulation;
        const reviewedPatch = createReviewedPatch(graph, patch, result);
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
        context.presentResult?.({ tool: "simulate_cast", simulation: result, previewPatch: reviewedPatch });
        return {
          ...result,
          preview: {
            patchId: patch.id,
            baseGraphVersion: graph.version,
            simulatedGraphVersion: result.graphVersion,
            editorMutated: false,
          },
          patchReview: {
            operationLedger: reviewedPatch.operationLedger,
            reviewSummary: reviewedPatch.reviewSummary,
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
      const sideEffectId = requireString(parsed.sideEffectId, "sideEffectId", "explain_side_effect");
      if (sideEffectId !== context.getGraph().semantics.effectId) {
        throw new Error(
          `explain_side_effect: unknown side effect ${sideEffectId}; effect IDs come from sideEffects[].id on a prior simulate_cast`,
        );
      }
      const explanation = explainSideEffect(context.getGraph());
      context.recordActivity(
        "explain_side_effect",
        explanation.present
          ? `Proved a ${explanation.subgraph.edges.length}-edge minimal causal subgraph for the side effect.`
          : explanation.explanation,
        explanation.nodeIds,
      );
      return { requestedId: sideEffectId, ...explanation };
    },
    set_sacred_constraint: async (input: unknown = {}) => {
      const releaseConstraint = (before: SpellGraph, targetId: string) => {
        const next = cloneGraph(before);
        next.constraints = next.constraints.filter((constraint) => constraint.targetId !== targetId);
        next.version += 1;
        context.setGraph(next);
        context.recordActivity("set_sacred_constraint", `Released ${targetId}.`, [targetId]);
        context.presentResult?.({ tool: "set_sacred_constraint" });
        return {
          beforeVersion: before.version,
          graphVersion: next.version,
          before: before.constraints.map((constraint) => ({ ...constraint })),
          after: next.constraints.map((constraint) => ({ ...constraint })),
        };
      };
      const parsed = requireToolInput(input, "set_sacred_constraint", ["targetId", "reason", "preserve"]);
      const targetId = requireString(parsed.targetId, "targetId", "set_sacred_constraint");
      const preserve = parsed.preserve === undefined ? true : parsed.preserve;
      if (typeof preserve !== "boolean") throw new Error("preserve must be a boolean");
      const before = context.getGraph();
      requireNode(before, targetId, "set_sacred_constraint");
      if (targetId !== before.semantics.roles.subject) {
        // Naming the legal target would hand over the answer, so the message
        // says how to find it instead of leaving the agent with no next move.
        throw new Error(
          `set_sacred_constraint: ${targetId} is not the rune this scenario's human asked to protect. `
            + "Ground the target from inspect_spell by matching the rune against the human's stated constraint.",
        );
      }
      // `reason` records why the human wants a rune kept, so it is required to
      // set a lock and meaningless to release one. Demanding it on release made
      // an agent invent a justification that is immediately discarded.
      if (!preserve && parsed.reason === undefined) {
        return releaseConstraint(before, targetId);
      }
      const reason = requireShortText(requireString(parsed.reason, "reason", "set_sacred_constraint"), "Constraint reason", 180);
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
      return {
        beforeVersion: before.version,
        graphVersion: next.version,
        // Cloned: returning the live arrays let one result mutate another's,
        // and shared mutable state is not "exact before/after evidence".
        before: before.constraints.map((constraint) => ({ ...constraint })),
        after: next.constraints.map((constraint) => ({ ...constraint })),
      };
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
        return createReviewedPatch(graph, patch, predictedOutcome);
      });
      issuedPatches = {
        graphVersion: graph.version,
        patchIds: new Set(patches.map((patch) => patch.id)),
      };
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
        const revertToken = requireString(parsed.revertToken, "revertToken", "apply_spell_patch");
        if (!new RegExp(SPELL_REVERT_TOKEN_PATTERN).test(revertToken)) {
          throw new Error("Invalid revert token");
        }
        const current = context.getGraph();
        if (!reversiblePatch) {
          throw new Error("No patch is currently reversible; apply a patch before reverting one");
        }
        if (revertToken !== reversiblePatch.token) {
          // The old message said the token was unavailable or used, which is
          // misleading when a different, still-valid token exists: it tells an
          // agent rollback is gone when rollback is available.
          throw new Error(
            "Revert token does not match the reversible patch; use the revertToken returned by the last apply_spell_patch",
          );
        }
        if (current.version !== reversiblePatch.appliedVersion) {
          throw new Error(
            `Revert token is stale for graph v${current.version}; expected v${reversiblePatch.appliedVersion}`,
          );
        }

        const restored = cloneGraph(reversiblePatch.graphBeforeApply);
        const revertedPatch = reversiblePatch.reviewedPatch;
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
          revertedPatch: {
            patchId: revertedPatch.id,
            operationLedger: revertedPatch.operationLedger,
            reviewSummary: revertedPatch.reviewSummary,
          },
          verification,
        };
      }

      const patchId = requireString(parsed.patchId, "patchId", "apply_spell_patch");
      if (!new RegExp(SPELL_PATCH_ID_PATTERN).test(patchId)) {
        throw new Error(`Invalid patch ID: ${patchId}`);
      }
      const before = context.getGraph();
      requireIssuedPatch(before, patchId);
      const patch = proposePatches(before).find((candidate) => candidate.id === patchId);
      if (!patch) {
        throw new Error(
          `Patch ${patchId} is unavailable or stale for graph v${before.version}`,
        );
      }
      const next = applyPatch(before, patch);
      const verification = simulateCast(next);
      const reviewedPatch = createReviewedPatch(before, patch, verification);
      const revertToken = `revert-${patch.id}-after-v${next.version}`;
      context.setGraph(next);
      reversiblePatch = {
        token: revertToken,
        appliedVersion: next.version,
        graphBeforeApply: cloneGraph(before),
        reviewedPatch,
      };
      context.recordActivity("apply_spell_patch", `Applied ${patch.title}. ${verification.summary}`, patch.operations.flatMap((operation) => operation.op === "add_edge" ? [operation.edge.from, operation.edge.to] : operation.op === "activate_node" ? [operation.nodeId] : []));
      context.presentResult?.({ tool: "apply_spell_patch", verification, revertToken });
      return {
        action: "apply" as const,
        validatedPreconditions: patch.preconditions,
        appliedPatch: {
          patchId: reviewedPatch.id,
          operationLedger: reviewedPatch.operationLedger,
          reviewSummary: reviewedPatch.reviewSummary,
        },
        before: { version: before.version, edgeCount: before.edges.length },
        after: { version: next.version, edgeCount: next.edges.length },
        verification,
        revertToken,
      };
    },
  };
}

export type SpellToolHandlers = ReturnType<typeof createSpellToolHandlers>;
