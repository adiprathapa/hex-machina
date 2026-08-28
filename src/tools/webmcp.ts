import { createMoonflowerScenario } from "../scenarios/moonflower.ts";
import { MAX_TRACE_DEPTH, MAX_TRACE_PATHS } from "../solver/trace.ts";
import { MAX_INSPECT_NODES, type SpellToolHandlers } from "./handlers.ts";

interface WebMCPExecutionOptions {
  signal: AbortSignal;
}

interface WebMCPRegistrationOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

declare global {
  interface Document {
    modelContext?: {
      registerTool(definition: {
        name: string;
        title?: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations?: {
          readOnlyHint?: boolean;
          untrustedContentHint?: boolean;
        };
        execute(input: unknown, options?: WebMCPExecutionOptions): Promise<unknown>;
      }, options?: WebMCPRegistrationOptions): Promise<void> | void;
    };
  }
}

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const moonflowerRuneIds = createMoonflowerScenario().nodes.map((node) => node.id);
const trustedReadAnnotations = { readOnlyHint: true, untrustedContentHint: false };
const trustedWriteAnnotations = { readOnlyHint: false, untrustedContentHint: false };

function withExecutionSignal<T>(handler: (input: unknown) => Promise<T>) {
  return (input: unknown, options?: WebMCPExecutionOptions) => {
    if (options?.signal.aborted) {
      return Promise.reject(
        options.signal.reason ?? new DOMException("Tool execution was cancelled", "AbortError"),
      );
    }
    return handler(input);
  };
}

export async function registerWebMCPTools(
  handlers: SpellToolHandlers,
  lifecycleSignal?: AbortSignal,
) {
  if (typeof document.modelContext?.registerTool !== "function") return false;
  const modelContext = document.modelContext;

  const registration = new AbortController();
  if (lifecycleSignal?.aborted) registration.abort(lifecycleSignal.reason);
  lifecycleSignal?.addEventListener(
    "abort",
    () => registration.abort(lifecycleSignal.reason),
    { once: true },
  );

  const definitions = [
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
            items: {
              type: "string",
              enum: moonflowerRuneIds,
            },
            minItems: 1,
            maxItems: MAX_INSPECT_NODES,
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
      annotations: trustedReadAnnotations,
      execute: withExecutionSignal(handlers.inspect_spell),
    },
    {
      name: "trace_effect",
      title: "Trace spell effect",
      description: "Trace bounded, ordered causal paths from a source or into a known spell effect, including cycles and type violations.",
      inputSchema: {
        type: "object",
        properties: {
          effectId: {
            type: "string",
            description: "The known effect to trace; defaults to the current observatory flood.",
            enum: ["flooded-observatory"],
          },
          sourceId: {
            type: "string",
            description: "Optional active source rune to trace forward; mutually exclusive with effectId.",
            enum: ["moonwell"],
          },
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
      execute: withExecutionSignal(handlers.trace_effect),
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
            pattern: "^patch-(umbrella|direct)-v[0-9]+$",
          },
        },
        additionalProperties: false,
      },
      annotations: trustedReadAnnotations,
      execute: withExecutionSignal(handlers.simulate_cast),
    },
    {
      name: "explain_side_effect",
      title: "Explain side effect",
      description: "Return the smallest typed responsible subgraph, ordered causal steps, simulator-rule premises, and an edge-necessity proof for a side effect.",
      inputSchema: {
        type: "object",
        properties: {
          sideEffectId: {
            type: "string",
            description: "The side-effect identifier returned by simulate_cast.",
            enum: ["flooded-observatory"],
          },
        },
        required: ["sideEffectId"],
        additionalProperties: false,
      },
      annotations: trustedReadAnnotations,
      execute: withExecutionSignal(handlers.explain_side_effect),
    },
    {
      name: "set_sacred_constraint",
      title: "Set sacred constraint",
      description: "Add, update, or remove a reversible human-authored preservation constraint.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: {
            type: "string",
            description: "The rune whose meaning the human wants to preserve.",
            enum: ["summon-ducks"],
          },
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
      execute: withExecutionSignal(handlers.set_sacred_constraint),
    },
    {
      name: "propose_spell_patch",
      title: "Propose spell patch",
      description: "Search for ranked spell repairs with explicit graph, edge, dormant-rune, and sacred-constraint preconditions without changing the graph.",
      inputSchema: emptySchema,
      annotations: trustedReadAnnotations,
      execute: withExecutionSignal(handlers.propose_spell_patch),
    },
    {
      name: "apply_spell_patch",
      title: "Apply spell patch",
      description: "Atomically revalidate and apply every precondition of a versioned spell patch, or revert the most recent unchanged application with its one-use token.",
      inputSchema: {
        type: "object",
        properties: {
          patchId: {
            type: "string",
            description: "A current patch ID returned by propose_spell_patch.",
            pattern: "^patch-(umbrella|direct)-v[0-9]+$",
          },
          revertToken: {
            type: "string",
            description: "The one-use token returned by the latest unchanged patch application.",
            pattern: "^revert-patch-(umbrella|direct)-v[0-9]+-after-v[0-9]+$",
          },
        },
        oneOf: [
          { required: ["patchId"] },
          { required: ["revertToken"] },
        ],
        additionalProperties: false,
      },
      annotations: trustedWriteAnnotations,
      execute: withExecutionSignal(handlers.apply_spell_patch),
    },
  ];

  try {
    await Promise.all(
      definitions.map((definition) => modelContext.registerTool(
        definition,
        { signal: registration.signal },
      )),
    );
    return true;
  } catch (error) {
    registration.abort();
    throw error;
  }
}
