import { createMoonflowerScenario } from "../scenarios/moonflower.ts";
import { type SpellToolHandlers } from "./handlers.ts";
import {
  createSpellToolManifest,
  SPELL_PATCH_ID_PATTERN,
  SPELL_REVERT_TOKEN_PATTERN,
} from "./definitions.ts";

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

  const canonical = createMoonflowerScenario();
  const manifest = createSpellToolManifest({
    runeIds: canonical.nodes.map((node) => node.id),
    sourceIds: canonical.nodes.filter((node) => node.kind === "source").map((node) => node.id),
    effectIds: [canonical.semantics.effectId],
    sacredTargetIds: [canonical.semantics.roles.subject],
    patchIdPattern: SPELL_PATCH_ID_PATTERN,
    revertTokenPattern: SPELL_REVERT_TOKEN_PATTERN,
  });
  const definitions = manifest.tools.map((definition) => {
    const execute = handlers[definition.name] as (input: unknown) => Promise<unknown>;
    return { ...definition, execute: withExecutionSignal(execute) };
  });

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
