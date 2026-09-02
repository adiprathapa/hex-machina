import { MAX_TRACE_DEPTH, MAX_TRACE_PATHS } from "../solver/trace.ts";

export const SPELL_TOOL_MANIFEST_PROTOCOL = "hexmend-tool-manifest/v1" as const;
export const MAX_INSPECT_NODES = 12;
export const SPELL_PATCH_ID_PATTERN = "^patch-(umbrella|dampener|temporal-guard|direct)-v[0-9]+$";
export const SPELL_REVERT_TOKEN_PATTERN = "^revert-patch-(umbrella|dampener|temporal-guard|direct)-v[0-9]+-after-v[0-9]+$";
export const GENERIC_SPELL_PATCH_ID_PATTERN = "^patch-[a-z0-9-]{1,96}-v[0-9]+$";
export const GENERIC_SPELL_REVERT_TOKEN_PATTERN = "^revert-patch-[a-z0-9-]{1,96}-v[0-9]+-after-v[0-9]+$";

export const SPELL_TOOL_NAMES = [
  "inspect_spell",
  "trace_effect",
  "simulate_cast",
  "explain_side_effect",
  "set_sacred_constraint",
  "propose_spell_patch",
  "apply_spell_patch",
] as const;

export type SpellToolName = typeof SPELL_TOOL_NAMES[number];

export interface SpellToolDefinition {
  name: SpellToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: false;
  };
}

interface SpellToolDefinitionContext {
  runeIds?: readonly string[];
  sourceIds?: readonly string[];
  effectIds?: readonly string[];
  sacredTargetIds?: readonly string[];
  patchIdPattern?: string;
  revertTokenPattern?: string;
}

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const trustedReadAnnotations = { readOnlyHint: true, untrustedContentHint: false } as const;
const trustedWriteAnnotations = { readOnlyHint: false, untrustedContentHint: false } as const;

function boundedId(description: string, values?: readonly string[]) {
  return {
    type: "string",
    description,
    minLength: 1,
    maxLength: 128,
    ...(values ? { enum: [...values] } : {}),
  };
}

/**
 * Serializable action contract shared by WebMCP registration and headless
 * Agent Gym clients. Optional enums narrow the canonical browser surface;
 * omitting them avoids leaking task-specific identifiers before a rollout.
 */
export function createSpellToolManifest(context: SpellToolDefinitionContext = {}) {
  const tools: SpellToolDefinition[] = [
    {
      name: "inspect_spell",
      title: "Inspect spell",
      description: "Inspect the current spell graph, its version, desired outcome, and sacred constraints.",
      inputSchema: {
        type: "object",
        properties: {
          nodeIds: {
            type: "array",
            description: "Optional unique rune IDs to include; omit to inspect the complete spell.",
            items: boundedId("A rune ID returned by reset or inspect_spell.", context.runeIds),
            minItems: 1,
            maxItems: MAX_INSPECT_NODES,
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
      annotations: trustedReadAnnotations,
    },
    {
      name: "trace_effect",
      title: "Trace spell effect",
      description: "Trace bounded, ordered causal paths from a source or into a known spell effect, including cycles and type violations.",
      inputSchema: {
        type: "object",
        properties: {
          effectId: boundedId(
            "A side-effect ID returned by simulate_cast; omit to trace the current active effect.",
            context.effectIds,
          ),
          sourceId: boundedId(
            "Optional active source rune to trace forward; mutually exclusive with effectId.",
            context.sourceIds,
          ),
          maxDepth: {
            type: "integer",
            description: "Maximum number of directed edges per returned path; defaults to 8.",
            minimum: 1,
            maximum: MAX_TRACE_DEPTH,
          },
          maxPaths: {
            type: "integer",
            description: "Maximum number of ordered paths to return; defaults to 3.",
            minimum: 1,
            maximum: MAX_TRACE_PATHS,
          },
        },
        oneOf: [
          { required: ["effectId"], not: { required: ["sourceId"] } },
          { required: ["sourceId"], not: { required: ["effectId"] } },
          { not: { anyOf: [{ required: ["effectId"] }, { required: ["sourceId"] }] } },
        ],
        additionalProperties: false,
      },
      annotations: trustedReadAnnotations,
    },
    {
      name: "simulate_cast",
      title: "Simulate cast",
      description: "Simulate the current spell or a current proposed patch without mutating editor state, and return an ordered event trace.",
      inputSchema: {
        type: "object",
        properties: {
          patchId: {
            type: "string",
            description: "Optional current patch ID from propose_spell_patch to simulate as an unapplied preview.",
            pattern: context.patchIdPattern ?? GENERIC_SPELL_PATCH_ID_PATTERN,
            maxLength: 128,
          },
        },
        additionalProperties: false,
      },
      annotations: trustedReadAnnotations,
    },
    {
      name: "explain_side_effect",
      title: "Explain side effect",
      description: "Return the smallest typed responsible subgraph, ordered causal steps, simulator-rule premises, and an edge-necessity proof for a side effect.",
      inputSchema: {
        type: "object",
        properties: {
          sideEffectId: boundedId(
            "The side-effect identifier returned by simulate_cast.",
            context.effectIds,
          ),
        },
        required: ["sideEffectId"],
        additionalProperties: false,
      },
      annotations: trustedReadAnnotations,
    },
    {
      name: "set_sacred_constraint",
      title: "Set sacred constraint",
      description: "Add, update, or remove a reversible human-authored preservation constraint.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: boundedId(
            "The rune whose meaning the human wants to preserve.",
            context.sacredTargetIds,
          ),
          reason: {
            type: "string",
            description: "A short human-authored explanation of why this rune matters.",
            minLength: 1,
            maxLength: 180,
          },
          preserve: {
            type: "boolean",
            description: "True to add or update the constraint; false to release it.",
          },
        },
        required: ["targetId", "reason"],
        additionalProperties: false,
      },
      annotations: trustedWriteAnnotations,
    },
    {
      name: "propose_spell_patch",
      title: "Propose spell patch",
      description: "Search for ranked spell repairs and return predicted outcomes, explicit preconditions, and the same structured operation ledger shown to the human without changing the graph.",
      inputSchema: emptySchema,
      annotations: trustedReadAnnotations,
    },
    {
      name: "apply_spell_patch",
      title: "Apply spell patch",
      description: "Atomically revalidate and apply the exact human-reviewed operation ledger for a versioned spell patch, or revert it with a one-use token and matching receipt.",
      inputSchema: {
        type: "object",
        properties: {
          patchId: {
            type: "string",
            description: "A current patch ID returned by propose_spell_patch.",
            pattern: context.patchIdPattern ?? GENERIC_SPELL_PATCH_ID_PATTERN,
            maxLength: 128,
          },
          revertToken: {
            type: "string",
            description: "The one-use token returned by the latest unchanged patch application.",
            pattern: context.revertTokenPattern ?? GENERIC_SPELL_REVERT_TOKEN_PATTERN,
            maxLength: 160,
          },
        },
        oneOf: [
          { required: ["patchId"] },
          { required: ["revertToken"] },
        ],
        additionalProperties: false,
      },
      annotations: trustedWriteAnnotations,
    },
  ];

  return {
    protocol: SPELL_TOOL_MANIFEST_PROTOCOL,
    actionFormat: {
      type: "object",
      required: ["tool"],
      properties: {
        tool: { type: "string", enum: [...SPELL_TOOL_NAMES] },
        input: { type: "object" },
      },
      additionalProperties: false,
    },
    tools,
  };
}
