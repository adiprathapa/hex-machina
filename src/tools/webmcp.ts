import type { SpellToolHandlers } from "./handlers.ts";

declare global {
  interface Document {
    modelContext?: {
      registerTool(definition: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
        execute(input: never): Promise<unknown>;
      }): Promise<void> | void;
    };
  }
}

const emptySchema = { type: "object", properties: {}, additionalProperties: false };

export async function registerWebMCPTools(handlers: SpellToolHandlers) {
  if (typeof document.modelContext?.registerTool !== "function") return false;

  const definitions = [
    {
      name: "inspect_spell",
      description: "Inspect the current spell graph, its version, desired outcome, and sacred constraints.",
      inputSchema: {
        type: "object",
        properties: {
          nodeIds: {
            type: "array",
            items: {
              type: "string",
              enum: ["moonwell", "multiply", "summon-ducks", "umbrella", "pour", "room", "moonflower", "bloom"],
            },
            maxItems: 8,
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: handlers.inspect_spell,
    },
    {
      name: "trace_effect",
      description: "Trace the bounded causal path responsible for a spell effect or current failure.",
      inputSchema: {
        type: "object",
        properties: { effectId: { type: "string", enum: ["flooded-observatory"] } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: handlers.trace_effect,
    },
    {
      name: "simulate_cast",
      description: "Simulate the current spell without mutating editor state and return an ordered event trace.",
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute: handlers.simulate_cast,
    },
    {
      name: "explain_side_effect",
      description: "Explain a side effect from the smallest responsible spell subgraph.",
      inputSchema: {
        type: "object",
        properties: { sideEffectId: { type: "string", enum: ["flooded-observatory"] } },
        required: ["sideEffectId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: handlers.explain_side_effect,
    },
    {
      name: "set_sacred_constraint",
      description: "Add, update, or remove a reversible human-authored preservation constraint.",
      inputSchema: {
        type: "object",
        properties: {
          targetId: { type: "string", enum: ["summon-ducks"] },
          reason: { type: "string", minLength: 1, maxLength: 180 },
          preserve: { type: "boolean" },
        },
        required: ["targetId", "reason"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: handlers.set_sacred_constraint,
    },
    {
      name: "propose_spell_patch",
      description: "Search for ranked spell repairs under the current sacred constraints without changing the graph.",
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute: handlers.propose_spell_patch,
    },
    {
      name: "apply_spell_patch",
      description: "Atomically apply a versioned spell patch and return before/after evidence plus a verification cast.",
      inputSchema: {
        type: "object",
        properties: {
          patchId: {
            type: "string",
            pattern: "^patch-(umbrella|direct)-v[0-9]+$",
          },
        },
        required: ["patchId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: handlers.apply_spell_patch,
    },
  ];

  await Promise.all(
    definitions.map((definition) => document.modelContext?.registerTool(definition as never)),
  );
  return true;
}
