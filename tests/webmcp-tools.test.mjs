import assert from "node:assert/strict";
import test from "node:test";

import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { createSpellToolHandlers } from "../src/tools/handlers.ts";
import { registerWebMCPTools } from "../src/tools/webmcp.ts";

test("registers seven narrow WebMCP tools with honest mutation hints", async () => {
  const definitions = [];
  const registrationOptions = [];
  globalThis.document = {
    modelContext: {
      registerTool(definition, options) {
        definitions.push(definition);
        registrationOptions.push(options);
      },
    },
  };

  let graph = createMoonflowerScenario();
  const handlers = createSpellToolHandlers({
    getGraph: () => graph,
    setGraph: (next) => { graph = next; },
    recordActivity() {},
  });
  const supported = await registerWebMCPTools(handlers);
  assert.equal(supported, true);
  assert.equal(definitions.length, 7);
  assert.equal(registrationOptions.every((options) => options.signal instanceof AbortSignal), true);
  assert.equal(definitions.every((item) => typeof item.title === "string" && item.title.length > 0), true);
  assert.deepEqual(
    definitions.map((item) => item.name).sort(),
    [
      "apply_spell_patch",
      "explain_side_effect",
      "inspect_spell",
      "propose_spell_patch",
      "set_sacred_constraint",
      "simulate_cast",
      "trace_effect",
    ],
  );

  const readOnly = definitions.filter((item) => item.annotations?.readOnlyHint).map((item) => item.name);
  assert.equal(readOnly.includes("simulate_cast"), true);
  assert.equal(readOnly.includes("propose_spell_patch"), true);
  assert.equal(readOnly.includes("apply_spell_patch"), false);
  assert.equal(definitions.every((item) => item.annotations?.untrustedContentHint === false), true);
  assert.equal(definitions.every((item) => !("destructiveHint" in item.annotations)), true);
  assert.equal(definitions.every((item) => item.inputSchema.additionalProperties === false), true);
  const applyTool = definitions.find((item) => item.name === "apply_spell_patch");
  assert.deepEqual(applyTool.inputSchema.oneOf, [
    { required: ["patchId"] },
    { required: ["revertToken"] },
  ]);
  assert.equal(applyTool.inputSchema.properties.patchId.type, "string");
  assert.equal(applyTool.inputSchema.properties.revertToken.type, "string");
  const inspectTool = definitions.find((item) => item.name === "inspect_spell");
  const inspectNodeIds = inspectTool.inputSchema.properties.nodeIds;
  assert.equal(inspectNodeIds.maxItems, 12);
  assert.equal(typeof inspectNodeIds.description, "string");
  assert.deepEqual(inspectNodeIds.items.enum, createMoonflowerScenario().nodes.map((node) => node.id));
  const simulateTool = definitions.find((item) => item.name === "simulate_cast");
  assert.equal(simulateTool.inputSchema.properties.patchId.type, "string");
  assert.equal(simulateTool.inputSchema.properties.patchId.pattern, "^patch-(umbrella|direct)-v[0-9]+$");
  assert.equal(
    definitions.flatMap((item) => Object.values(item.inputSchema.properties)).every(
      (property) => typeof property.description === "string" && property.description.length > 0,
    ),
    true,
  );

  const cancelled = new AbortController();
  cancelled.abort(new Error("cancelled before execution"));
  await assert.rejects(
    definitions.find((item) => item.name === "simulate_cast").execute({}, { signal: cancelled.signal }),
    /cancelled before execution/,
  );
});

test("registration lifecycle removes tools before a Strict Mode remount", async () => {
  const registered = new Map();
  globalThis.document = {
    modelContext: {
      registerTool(definition, options = {}) {
        if (registered.has(definition.name)) {
          return Promise.reject(new DOMException(`Duplicate tool: ${definition.name}`, "InvalidStateError"));
        }
        if (options.signal?.aborted) return Promise.reject(options.signal.reason);
        registered.set(definition.name, definition);
        options.signal?.addEventListener("abort", () => registered.delete(definition.name), { once: true });
        return Promise.resolve();
      },
    },
  };

  let graph = createMoonflowerScenario();
  const handlers = createSpellToolHandlers({
    getGraph: () => graph,
    setGraph: (next) => { graph = next; },
    recordActivity() {},
  });

  const firstMount = new AbortController();
  assert.equal(await registerWebMCPTools(handlers, firstMount.signal), true);
  assert.equal(registered.size, 7);
  firstMount.abort();
  assert.equal(registered.size, 0);

  const secondMount = new AbortController();
  assert.equal(await registerWebMCPTools(handlers, secondMount.signal), true);
  assert.equal(registered.size, 7);
  secondMount.abort();
  assert.equal(registered.size, 0);
});

test("tool handlers preserve human intent through a verified write", async () => {
  let graph = createMoonflowerScenario();
  const events = [];
  const presentations = [];
  const handlers = createSpellToolHandlers({
    getGraph: () => graph,
    setGraph: (next) => { graph = next; },
    recordActivity(tool, detail) { events.push({ tool, detail }); },
    presentResult(event) { presentations.push(event); },
  });

  const inspection = await handlers.inspect_spell({ nodeIds: ["multiply", "summon-ducks"] });
  assert.deepEqual(inspection.nodes.map((node) => node.id), ["multiply", "summon-ducks"]);
  const failed = await handlers.simulate_cast();
  assert.equal(failed.success, false);
  const trace = await handlers.trace_effect({ effectId: "flooded-observatory" });
  assert.equal(trace.present, true);
  const explanation = await handlers.explain_side_effect({ sideEffectId: "flooded-observatory" });
  assert.equal(explanation.requestedId, "flooded-observatory");
  await handlers.set_sacred_constraint({
    targetId: "summon-ducks",
    reason: "They are funny.",
  });
  const proposal = await handlers.propose_spell_patch();
  assert.equal(proposal.patches[0].preserves.includes("summon-ducks"), true);
  assert.equal(proposal.patches[0].searchEvidence.editCount, 8);
  assert.equal(proposal.patches[0].searchEvidence.eligibleCandidateCount, 1);
  const graphBeforePreview = JSON.stringify(graph);
  const preview = await handlers.simulate_cast({ patchId: proposal.patches[0].id });
  assert.equal(preview.success, true);
  assert.deepEqual(preview.preview, {
    patchId: proposal.patches[0].id,
    baseGraphVersion: 2,
    simulatedGraphVersion: 3,
    editorMutated: false,
  });
  assert.equal(JSON.stringify(graph), graphBeforePreview, "a patch simulation must not mutate editor state");
  const result = await handlers.apply_spell_patch({ patchId: proposal.patches[0].id });
  assert.equal(result.action, "apply");
  assert.equal(result.verification.success, true);
  assert.equal(result.verification.assertions.ducksPresent, true);
  assert.equal(result.verification.assertions.duckCount, 12);
  assert.match(result.revertToken, /^revert-patch-umbrella/);
  const reverted = await handlers.apply_spell_patch({ revertToken: result.revertToken });
  assert.equal(reverted.action, "revert");
  assert.equal(reverted.verification.success, false);
  assert.equal(reverted.verification.assertions.ducksPresent, true);
  assert.equal(graph.version, 4);
  assert.equal(graph.constraints.some((constraint) => constraint.targetId === "summon-ducks"), true);
  await assert.rejects(
    handlers.apply_spell_patch({ revertToken: result.revertToken }),
    /unavailable or has already been used/,
  );
  assert.deepEqual(
    new Set(events.map((event) => event.tool)),
    new Set([
      "inspect_spell",
      "simulate_cast",
      "trace_effect",
      "explain_side_effect",
      "set_sacred_constraint",
      "propose_spell_patch",
      "simulate_cast",
      "apply_spell_patch",
    ]),
  );
  assert.equal(events.some((event) => event.tool === "apply_spell_patch"), true);
  assert.deepEqual(
    presentations.map((event) => event.tool),
    [
      "simulate_cast",
      "set_sacred_constraint",
      "propose_spell_patch",
      "simulate_cast",
      "apply_spell_patch",
      "apply_spell_patch",
    ],
  );
});

test("tool handlers reject malformed, unknown, and stale inputs without mutation", async () => {
  let graph = createMoonflowerScenario();
  const handlers = createSpellToolHandlers({
    getGraph: () => graph,
    setGraph: (next) => { graph = next; },
    recordActivity() {},
  });
  const initialGraph = JSON.stringify(graph);

  await assert.rejects(
    handlers.set_sacred_constraint({ targetId: "dragon", reason: "Keep it." }),
    /Unknown rune/,
  );
  await assert.rejects(
    handlers.set_sacred_constraint({ targetId: "moonwell", reason: "Keep it." }),
    /Unsupported sacred target/,
  );
  await assert.rejects(
    handlers.set_sacred_constraint({ targetId: "summon-ducks", reason: "Keep it.", preserve: "yes" }),
    /preserve must be a boolean/,
  );
  await assert.rejects(
    handlers.explain_side_effect({ sideEffectId: "exploding-moon" }),
    /Unknown side effect/,
  );
  await assert.rejects(handlers.explain_side_effect({}), /sideEffectId must be a string/);
  await assert.rejects(
    handlers.trace_effect({ effectId: "exploding-moon" }),
    /Unknown effect/,
  );
  await assert.rejects(
    handlers.inspect_spell({ nodeIds: ["moonwell", "moonwell"] }),
    /must be unique/,
  );
  await assert.rejects(handlers.inspect_spell(null), /input must be an object/);
  await assert.rejects(handlers.simulate_cast({ seed: 99 }), /unknown field: seed/);
  await assert.rejects(handlers.simulate_cast({ patchId: "anything" }), /Invalid patch ID/);
  await assert.rejects(
    handlers.simulate_cast({ patchId: "patch-umbrella-v999" }),
    /unavailable or stale/,
  );
  await assert.rejects(handlers.propose_spell_patch({ limit: 99 }), /unknown field: limit/);
  await assert.rejects(
    handlers.apply_spell_patch({ patchId: "anything", force: true }),
    /unknown field: force/,
  );
  await assert.rejects(
    handlers.apply_spell_patch({}),
    /exactly one of patchId or revertToken/,
  );
  await assert.rejects(
    handlers.apply_spell_patch({ patchId: "patch-direct-v1", revertToken: "revert-patch-direct-v1-after-v2" }),
    /exactly one of patchId or revertToken/,
  );
  await assert.rejects(
    handlers.apply_spell_patch({ revertToken: "anything" }),
    /Invalid revert token/,
  );
  await assert.rejects(
    handlers.apply_spell_patch({ revertToken: "revert-patch-direct-v1-after-v2" }),
    /unavailable or has already been used/,
  );
  await assert.rejects(
    handlers.apply_spell_patch({ patchId: "anything" }),
    /Invalid patch ID/,
  );
  await assert.rejects(
    handlers.apply_spell_patch({ patchId: "patch-umbrella-v999" }),
    /unavailable or stale/,
  );
  assert.equal(JSON.stringify(graph), initialGraph);
});

test("revert tokens fail closed after an intervening graph mutation", async () => {
  let graph = createMoonflowerScenario();
  const handlers = createSpellToolHandlers({
    getGraph: () => graph,
    setGraph: (next) => { graph = next; },
    recordActivity() {},
  });

  await handlers.set_sacred_constraint({
    targetId: "summon-ducks",
    reason: "They are funny.",
  });
  const proposal = await handlers.propose_spell_patch();
  const applied = await handlers.apply_spell_patch({ patchId: proposal.patches[0].id });
  await handlers.set_sacred_constraint({
    targetId: "summon-ducks",
    reason: "They are funny and now have names.",
  });
  const snapshot = JSON.stringify(graph);

  await assert.rejects(
    handlers.apply_spell_patch({ revertToken: applied.revertToken }),
    /Revert token is stale for graph v4; expected v3/,
  );
  assert.equal(JSON.stringify(graph), snapshot);
});
