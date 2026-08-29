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

function currentModelContext() {
  // `document` itself may be absent in SSR, a worker, or a test runner, so it
  // cannot be dereferenced before it is checked.
  if (typeof document === "undefined") return null;
  return typeof document.modelContext?.registerTool === "function"
    ? document.modelContext
    : null;
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

  return new Promise<typeof document.modelContext | null>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout>;
    const settle = (value: typeof document.modelContext | null) => {
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

export async function registerWebMCPTools(
  handlers: SpellToolHandlers,
  lifecycleSignal?: AbortSignal,
  readinessTimeoutMs = MODEL_CONTEXT_READINESS_TIMEOUT_MS,
) {
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
