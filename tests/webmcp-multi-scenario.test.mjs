import assert from "node:assert/strict";
import test from "node:test";

import { cloneGraph } from "../src/domain/spell.ts";
import { AgentGymSession, instrumentSpellToolHandlers } from "../src/eval/agent-gym.ts";
import { groundConstraintTarget } from "../src/eval/reference-policy.ts";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  generateAgentGymScenarioForFamily,
} from "../src/scenarios/agent-gym-family.ts";
import { createSpellToolHandlers } from "../src/tools/handlers.ts";
import { registerWebMCPTools } from "../src/tools/webmcp.ts";

function sessionFor(variant, graph) {
  return new AgentGymSession({
    familyId: variant.familyId,
    scenarioId: variant.scenarioId,
    seed: variant.seed,
    objective: variant.objective,
    humanConstraint: variant.humanConstraint,
    split: variant.split,
    variantIndex: variant.index,
    perturbations: variant.perturbations,
  }, graph);
}

async function executeRegisteredJourney(registered, variant, session, getGraph) {
  const call = (name, input = {}) => registered.get(name).execute(input, {});
  const inspection = await call("inspect_spell");
  const subject = groundConstraintTarget(inspection.nodes, variant.humanConstraint);

  const failedCast = await call("simulate_cast");
  assert.equal(failedCast.success, false, `${variant.scenarioId}: initial cast must fail`);
  const effectId = failedCast.sideEffects[0]?.id;
  assert.equal(effectId, variant.graph.semantics.effectId);

  await call("trace_effect", { effectId });
  await call("explain_side_effect", { sideEffectId: effectId });
  await call("set_sacred_constraint", {
    targetId: subject.id,
    reason: variant.humanConstraint,
  });
  const proposal = await call("propose_spell_patch");
  const patchId = proposal.patches[0]?.id;
  assert.ok(patchId, `${variant.scenarioId}: preserving repair must be available`);

  const preview = await call("simulate_cast", { patchId });
  assert.equal(preview.success, true, `${variant.scenarioId}: patch preview must succeed`);
  assert.equal(preview.preview.editorMutated, false);
  await call("apply_spell_patch", { patchId });
  const verified = await call("simulate_cast");

  const snapshot = session.snapshot();
  assert.equal(verified.success, true, `${variant.scenarioId}: applied repair must succeed`);
  assert.equal(snapshot.status, "complete");
  assert.equal(snapshot.score, snapshot.maxScore);
  assert.equal(snapshot.constraintPreserved, true);
  assert.equal(snapshot.scenarioId, variant.scenarioId);
  assert.equal(snapshot.familyId, variant.familyId);
  assert.equal(snapshot.split, variant.split);
  assert.equal(snapshot.variantIndex, variant.index);
  assert.equal(snapshot.trajectory.length, 9);
  assert.equal(
    getGraph().constraints.some((constraint) => constraint.targetId === subject.id),
    true,
    `${variant.scenarioId}: the grounded human constraint must remain in graph state`,
  );
}

test("all 96 task swaps re-register scenario-correct WebMCP tools and complete through them", async () => {
  const previousDocument = globalThis.document;
  const registered = new Map();
  const manifestSignatures = new Set();
  const completedByFamily = new Map();

  globalThis.document = {
    modelContext: {
      registerTool(definition, options = {}) {
        if (registered.has(definition.name)) {
          return Promise.reject(new Error(`duplicate live tool ${definition.name}`));
        }
        registered.set(definition.name, definition);
        options.signal?.addEventListener(
          "abort",
          () => registered.delete(definition.name),
          { once: true },
        );
        return Promise.resolve();
      },
    },
  };

  try {
    for (const [familyId, splitSizes] of Object.entries(AGENT_GYM_FAMILY_SPLIT_SIZES)) {
      for (const [split, count] of Object.entries(splitSizes)) {
        for (let index = 0; index < count; index += 1) {
          const variant = generateAgentGymScenarioForFamily(familyId, split, index);
          let graph = cloneGraph(variant.graph);
          const session = sessionFor(variant, graph);
          const shared = createSpellToolHandlers({
            getGraph: () => graph,
            setGraph: (next) => { graph = next; },
            recordActivity() {},
          });
          const handlers = instrumentSpellToolHandlers(shared, () => graph, session);
          const lifecycle = new AbortController();

          assert.equal(
            await registerWebMCPTools(handlers, lifecycle.signal, {
              scenario: graph,
              readinessTimeoutMs: 0,
            }),
            true,
          );
          assert.equal(registered.size, 7);
          assert.equal(session.snapshot().trajectory.length, 0, "registration is not a scored action");

          const advertisedRunes = registered
            .get("inspect_spell")
            .inputSchema.properties.nodeIds.items.enum;
          assert.deepEqual(
            [...advertisedRunes].sort(),
            graph.nodes.map((node) => node.id).sort(),
            `${variant.scenarioId}: manifest must advertise only the loaded graph`,
          );
          assert.deepEqual(
            registered.get("explain_side_effect").inputSchema.properties.sideEffectId.enum,
            [graph.semantics.effectId],
          );
          assert.equal(
            "enum" in registered.get("set_sacred_constraint").inputSchema.properties.targetId,
            false,
            `${variant.scenarioId}: registration must not reveal the protected rune`,
          );
          manifestSignatures.add([...advertisedRunes].sort().join("|"));

          await executeRegisteredJourney(registered, variant, session, () => graph);
          completedByFamily.set(familyId, (completedByFamily.get(familyId) ?? 0) + 1);

          lifecycle.abort(new Error("scenario replaced"));
          assert.equal(
            registered.size,
            0,
            `${variant.scenarioId}: every old tool must be removed before the next task registers`,
          );
        }
      }
    }

    assert.equal(manifestSignatures.size, 96, "every task must advertise its own opaque rune IDs");
    assert.deepEqual(
      Object.fromEntries(completedByFamily),
      { "family-01-v1": 48, "family-02-v1": 24, "family-03-v1": 24 },
    );
  } finally {
    globalThis.document = previousDocument;
  }
});
