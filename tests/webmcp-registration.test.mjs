import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_CONTEXT_READINESS_TIMEOUT_MS, registerWebMCPTools } from "../src/tools/webmcp.ts";
import { createSpellToolHandlers } from "../src/tools/handlers.ts";
import {
  AgentGymSession,
  createAgentGymEnvironment,
  instrumentSpellToolHandlers,
} from "../src/eval/agent-gym.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { createResonantAviaryScenario } from "../src/scenarios/resonant-aviary.ts";
import { cloneGraph } from "../src/domain/spell.ts";

/** Capture the tool definitions a host would receive, without a browser. */
async function capture(lifecycleSignal) {
  const registered = new Map();
  const previousDocument = globalThis.document;
  globalThis.document = {
    modelContext: {
      registerTool(definition, options) {
        if (options?.signal?.aborted) return Promise.reject(new Error("aborted"));
        registered.set(definition.name, definition);
        options?.signal?.addEventListener?.("abort", () => registered.delete(definition.name));
        return Promise.resolve();
      },
    },
  };
  try {
    const handlers = createSpellToolHandlers({
      getGraph: () => createMoonflowerScenario(),
      setGraph() {},
      recordActivity() {},
    });
    const result = await registerWebMCPTools(handlers, lifecycleSignal, { scenario: createMoonflowerScenario(), readinessTimeoutMs: 0 });
    return { result, registered };
  } finally {
    globalThis.document = previousDocument;
  }
}

function handlersFor(graph) {
  let current = cloneGraph(graph);
  return createSpellToolHandlers({
    getGraph: () => current,
    setGraph: (next) => { current = next; },
    recordActivity() {},
  });
}

test("a pre-aborted lifecycle signal registers nothing and says so", async () => {
  const aborted = AbortSignal.abort();
  const { result, registered } = await capture(aborted);

  assert.equal(result, false, "registration must report failure, not success");
  assert.equal(
    registered.size,
    0,
    "an already-aborted signal never fires an abort event, so tools registered here would stay live forever",
  );
});

test("a live lifecycle signal still registers all seven tools", async () => {
  const controller = new AbortController();
  const { result, registered } = await capture(controller.signal);
  assert.equal(result, true);
  assert.equal(registered.size, 7);
});

test("cancellation rejects with an Error even when the host supplies a string reason", async () => {
  const { registered } = await capture();
  const controller = new AbortController();
  controller.abort("user pressed stop");

  const rejection = await registered.get("inspect_spell")
    .execute({}, { signal: controller.signal })
    .then(() => null, (error) => error);

  assert.ok(rejection instanceof Error, "a bare string reason renders as [object Object] in most hosts");
  assert.match(rejection.message, /user pressed stop/);
});

test("a host that omits the signal gets a tool result, not a TypeError", async () => {
  const { registered } = await capture();
  // `options?.signal.aborted` optional-chained the bag but not the signal.
  const result = await registered.get("inspect_spell").execute({}, {});
  assert.ok(Array.isArray(result.nodes) && result.nodes.length > 0);
});


/** Install a host after a delay, the way an agent runtime injecting late would. */
function installModelContextAfter(delayMs, registered) {
  return setTimeout(() => {
    globalThis.document = {
      modelContext: {
        registerTool(definition) {
          registered.set(definition.name, definition);
          return Promise.resolve();
        },
      },
    };
  }, delayMs);
}

test("a host that installs modelContext after mount still gets the tools", async () => {
  const previousDocument = globalThis.document;
  const registered = new Map();
  globalThis.document = {};
  const timer = installModelContextAfter(120, registered);
  try {
    // The page does not control when a host installs its model context. This
    // used to feature-detect once and give up, so an agent runtime injecting
    // after React mounted found no tools and the page reported no WebMCP.
    const result = await registerWebMCPTools(handlersFor(createMoonflowerScenario()), undefined, { scenario: createMoonflowerScenario(), readinessTimeoutMs: 3000 });
    assert.equal(result, true, "late arrival must still register");
    assert.equal(registered.size, 7);
  } finally {
    clearTimeout(timer);
    globalThis.document = previousDocument;
  }
});

test("waiting is bounded, abortable, and never registers after an unmount", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {};
  try {
    const started = Date.now();
    assert.equal(
      await registerWebMCPTools(handlersFor(createMoonflowerScenario()), undefined, { scenario: createMoonflowerScenario(), readinessTimeoutMs: 150 }),
      false,
      "a browser that will never support WebMCP must settle on the fallback",
    );
    assert.ok(Date.now() - started < 2000, "the wait must be bounded by its timeout");

    const controller = new AbortController();
    const pending = registerWebMCPTools(handlersFor(createMoonflowerScenario()), controller.signal, { scenario: createMoonflowerScenario(), readinessTimeoutMs: 5000 });
    controller.abort();
    const abortedAt = Date.now();
    assert.equal(await pending, false, "an unmount must stop the wait");
    assert.ok(Date.now() - abortedAt < 1000, "abort must resolve promptly, not at the deadline");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("a missing document is detected instead of thrown on", async () => {
  const previousDocument = globalThis.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete globalThis.document;
  try {
    // `typeof document.modelContext` dereferences document first, so SSR, a
    // worker, or a bare test runner used to get a ReferenceError.
    assert.equal(await registerWebMCPTools(handlersFor(createMoonflowerScenario()), undefined, { scenario: createMoonflowerScenario(), readinessTimeoutMs: 0 }), false);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("the default readiness timeout is long enough to be useful and short enough to settle", () => {
  assert.ok(MODEL_CONTEXT_READINESS_TIMEOUT_MS >= 2000);
  assert.ok(MODEL_CONTEXT_READINESS_TIMEOUT_MS <= 15000);
});

test("the advertised schema tracks whatever scenario the app has loaded", async () => {
  // Registration receives handlers, not a graph, so the manifest used to be
  // built from a hardcoded scenario and could not follow a scenario switch.
  const previousDocument = globalThis.document;
  try {
    for (const scenario of [createMoonflowerScenario(), createResonantAviaryScenario()]) {
      const registered = new Map();
      globalThis.document = {
        modelContext: {
          registerTool(definition) { registered.set(definition.name, definition); return Promise.resolve(); },
        },
      };
      assert.equal(await registerWebMCPTools(handlersFor(scenario), undefined, { scenario, readinessTimeoutMs: 0 }), true);

      const runeEnum = registered.get("inspect_spell").inputSchema.properties.nodeIds.items.enum;
      assert.deepEqual(
        [...runeEnum].sort(),
        scenario.nodes.map((node) => node.id).sort(),
        `${scenario.id}: advertised rune IDs must be this scenario's`,
      );

      const effectEnum = registered.get("explain_side_effect").inputSchema.properties.sideEffectId.enum;
      assert.deepEqual(
        effectEnum,
        [scenario.semantics.effectId],
        `${scenario.id}: explain_side_effect must accept this scenario's effect`,
      );

      const sourceEnum = registered.get("trace_effect").inputSchema.properties.sourceId.enum;
      assert.deepEqual(
        [...sourceEnum].sort(),
        scenario.nodes.filter((node) => node.kind === "source").map((node) => node.id).sort(),
      );

      // The protected rune stays unenumerated on every scenario: it is the
      // answer an agent must ground from the human's stated constraint.
      const targetId = registered.get("set_sacred_constraint").inputSchema.properties.targetId;
      assert.equal("enum" in targetId, false, `${scenario.id}: the protected rune must not be published`);
    }
  } finally {
    globalThis.document = previousDocument;
  }
});

test("registering tools does not consume a scored episode step", async () => {
  // The app registers against Agent-Gym-instrumented handlers, so anything
  // registration calls on them is recorded as a transition and scored. Deriving
  // the manifest by calling inspect_spell did exactly that: the episode opened
  // at 1/23 with a step already spent, before the human had acted.
  const previousDocument = globalThis.document;
  globalThis.document = {
    modelContext: { registerTool() { return Promise.resolve(); } },
  };
  try {
    const gym = createAgentGymEnvironment({ split: "test", index: 0 });
    const reset = gym.reset();
    assert.equal(reset.episode.score, 0);

    let graph = createMoonflowerScenario();
    const instrumented = instrumentSpellToolHandlers(
      createSpellToolHandlers({
        getGraph: () => graph,
        setGraph: (next) => { graph = next; },
        recordActivity() {},
      }),
      () => graph,
      new AgentGymSession(),
    );

    const session = new AgentGymSession();
    const tracked = instrumentSpellToolHandlers(
      createSpellToolHandlers({
        getGraph: () => graph,
        setGraph: (next) => { graph = next; },
        recordActivity() {},
      }),
      () => graph,
      session,
    );
    assert.equal(session.snapshot().trajectory.length, 0);

    await registerWebMCPTools(tracked, undefined, {
      scenario: createMoonflowerScenario(),
      readinessTimeoutMs: 0,
    });

    assert.equal(
      session.snapshot().trajectory.length,
      0,
      "registration must not record a transition",
    );
    assert.equal(session.snapshot().score, 0, "registration must not move the score");
    assert.ok(instrumented, "both handler sets stay unused by registration");
  } finally {
    globalThis.document = previousDocument;
  }
});
