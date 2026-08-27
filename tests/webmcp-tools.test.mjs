import assert from "node:assert/strict";
import test from "node:test";

import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { createSpellToolHandlers } from "../src/tools/handlers.ts";
import { registerWebMCPTools } from "../src/tools/webmcp.ts";

test("registers seven narrow WebMCP tools with honest mutation hints", async () => {
  const definitions = [];
  globalThis.document = {
    modelContext: {
      registerTool(definition) {
        definitions.push(definition);
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
  assert.equal(definitions.every((item) => item.inputSchema.additionalProperties === false), true);
  const applyTool = definitions.find((item) => item.name === "apply_spell_patch");
  assert.deepEqual(applyTool.inputSchema.required, ["patchId"]);
  assert.equal(applyTool.inputSchema.properties.patchId.type, "string");
});

test("tool handlers preserve human intent through a verified write", async () => {
  let graph = createMoonflowerScenario();
  const events = [];
  const handlers = createSpellToolHandlers({
    getGraph: () => graph,
    setGraph: (next) => { graph = next; },
    recordActivity(tool, detail) { events.push({ tool, detail }); },
  });

  const failed = await handlers.simulate_cast();
  assert.equal(failed.success, false);
  await handlers.set_sacred_constraint({
    targetId: "summon-ducks",
    reason: "They are funny.",
  });
  const proposal = await handlers.propose_spell_patch();
  assert.equal(proposal.patches[0].preserves.includes("summon-ducks"), true);
  const result = await handlers.apply_spell_patch({ patchId: proposal.patches[0].id });
  assert.equal(result.verification.success, true);
  assert.equal(result.verification.assertions.ducksPresent, true);
  assert.equal(events.some((event) => event.tool === "apply_spell_patch"), true);
});

test("tool handlers reject unknown targets, side effects, and stale patch IDs", async () => {
  let graph = createMoonflowerScenario();
  const handlers = createSpellToolHandlers({
    getGraph: () => graph,
    setGraph: (next) => { graph = next; },
    recordActivity() {},
  });

  await assert.rejects(
    handlers.set_sacred_constraint({ targetId: "dragon", reason: "Keep it." }),
    /Unknown rune/,
  );
  await assert.rejects(
    handlers.explain_side_effect({ sideEffectId: "exploding-moon" }),
    /Unknown side effect/,
  );
  await assert.rejects(
    handlers.apply_spell_patch({ patchId: "patch-umbrella-v999" }),
    /unavailable or stale/,
  );
});
