import { type SpellToolHandlers } from "./handlers.ts";
import { type SpellGraph } from "../domain/spell.ts";
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

type ModelContextHost = {
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

declare global {
  interface Navigator {
    /** Where the earlier WebMCP explainer put the API; some hosts still do. */
    modelContext?: ModelContextHost;
  }
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
    // Optional-chained on the signal too: a host may pass an options bag
    // without one, and a TypeError is not a tool result.
    const signal = options?.signal;
    if (signal?.aborted) {
      // `reason` is host-supplied and often a bare string; a rejection value
      // that is not an Error renders as "[object Object]" in most MCP hosts.
      const reason = signal.reason;
      return Promise.reject(
        reason instanceof Error
          ? reason
          : new DOMException(
              typeof reason === "string" && reason ? reason : "Tool execution was cancelled",
              "AbortError",
            ),
      );
    }
    return handler(input);
  };
}

/** How long to keep waiting for a host to install `document.modelContext`. */
export const MODEL_CONTEXT_READINESS_TIMEOUT_MS = 8000;
const MODEL_CONTEXT_POLL_INTERVAL_MS = 100;

function currentModelContext(): ModelContextHost | null {
  // `document` itself may be absent in SSR, a worker, or a test runner, so it
  // cannot be dereferenced before it is checked. The current draft puts the
  // API on `document`; the earlier explainer put it on `navigator`, and a host
  // built against that still deserves the tools, so both are accepted.
  if (typeof document !== "undefined" && typeof document.modelContext?.registerTool === "function") {
    return document.modelContext;
  }
  if (typeof navigator !== "undefined" && typeof navigator.modelContext?.registerTool === "function") {
    return navigator.modelContext;
  }
  return null;
}

/** Whether a host has installed a model context on this page right now. */
export function hasModelContext() {
  return currentModelContext() !== null;
}

/**
 * Wait for the browser agent to install `document.modelContext`.
 *
 * Registration used to feature-detect once and give up. That is a race the page
 * does not control: hosts install their model context at different points, and
 * the registering effect's dependencies are stable, so nothing retried. An
 * agent runtime injecting after React mounts would find no tools at all, with
 * the page reporting WebMCP as unsupported.
 *
 * Polling rather than an event because the draft specifies no readiness signal
 * to listen for. Bounded and abort-scoped, so an unmount stops it immediately
 * and a browser that will never support WebMCP still settles on the fallback
 * experience within the timeout.
 */
function waitForModelContext(lifecycleSignal: AbortSignal | undefined, timeoutMs: number) {
  const immediate = currentModelContext();
  if (immediate || timeoutMs <= 0) return Promise.resolve(immediate);

  return new Promise<ModelContextHost | null>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout>;
    const settle = (value: ModelContextHost | null) => {
      clearTimeout(timer);
      lifecycleSignal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    function onAbort() { settle(null); }
    lifecycleSignal?.addEventListener("abort", onAbort, { once: true });

    const poll = () => {
      if (lifecycleSignal?.aborted) return settle(null);
      const found = currentModelContext();
      if (found) return settle(found);
      if (Date.now() >= deadline) return settle(null);
      timer = setTimeout(poll, MODEL_CONTEXT_POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, MODEL_CONTEXT_POLL_INTERVAL_MS);
  });
}

export interface WebMCPRegistrationSettings {
  /** The graph these tool definitions describe. */
  scenario: SpellGraph;
  /** How long to wait for a host to install `document.modelContext`. */
  readinessTimeoutMs?: number;
}

export async function registerWebMCPTools(
  handlers: SpellToolHandlers,
  lifecycleSignal: AbortSignal | undefined,
  settings: WebMCPRegistrationSettings,
) {
  const { scenario, readinessTimeoutMs = MODEL_CONTEXT_READINESS_TIMEOUT_MS } = settings;
  // Checked before anything else: a caller that has already unmounted must not
  // start a wait, and must not register. Aborting the internal controller and
  // falling through would register every tool against a host that only listens
  // for the abort event — which never fires on an already-aborted signal —
  // leaving them live, bound to an unmounted component, and reported as
  // successfully registered.
  if (lifecycleSignal?.aborted) return false;

  const modelContext = await waitForModelContext(lifecycleSignal, readinessTimeoutMs);
  if (!modelContext || lifecycleSignal?.aborted) return false;

  const registration = new AbortController();
  lifecycleSignal?.addEventListener(
    "abort",
    () => registration.abort(lifecycleSignal.reason),
    { once: true },
  );

  // Taken from the scenario being registered rather than a hardcoded one. The
  // manifest used to be built from `createMoonflowerScenario()` at call time,
  // so on any other scenario the advertised enums named runes and effects that
  // do not exist, and `explain_side_effect` and `set_sacred_constraint` became
  // impossible for a schema-conforming agent to call at all.
  //
  // Passed in rather than read back through `handlers.inspect_spell`: those
  // handlers may be instrumented by the Agent Gym, and registration must not
  // consume a scored step or move the episode before the human has acted.
  const manifest = createSpellToolManifest({
    runeIds: scenario.nodes.map((node) => node.id),
    sourceIds: scenario.nodes.filter((node) => node.kind === "source").map((node) => node.id),
    effectIds: [scenario.semantics.effectId],
    // Deliberately no sacredTargetIds enum. Which rune the human wants kept is
    // the thing an agent is meant to ground from the stated constraint, so
    // naming it in the tool definition would publish the answer.
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
