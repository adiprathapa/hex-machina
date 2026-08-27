import assert from "node:assert/strict";
import test from "node:test";

import { applyPatch, serializeSpellGraph, validateSpellGraph } from "../src/domain/spell.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { simulateCast } from "../src/simulator/cast.ts";
import { proposePatches } from "../src/solver/repair.ts";

test("moonflower fixture is valid and serializes deterministically", () => {
  const graph = createMoonflowerScenario();
  assert.deepEqual(validateSpellGraph(graph), []);
  assert.equal(serializeSpellGraph(graph), serializeSpellGraph(graph));
});

test("initial spell deterministically floods the room", () => {
  const graph = createMoonflowerScenario();
  const first = simulateCast(graph);
  const second = simulateCast(graph);
  assert.deepEqual(first, second);
  assert.equal(first.success, false);
  assert.equal(first.assertions.ducksPresent, true);
  assert.equal(first.assertions.roomFlooded, true);
  assert.equal(first.sideEffects[0].id, "flooded-observatory");
});

test("sacred ducks produce a distinct successful umbrella repair", () => {
  const graph = createMoonflowerScenario();
  graph.constraints.push({
    id: "sacred-summon-ducks",
    targetId: "summon-ducks",
    targetType: "node",
    requirement: "preserve",
    reason: "The ducks are funny.",
  });
  graph.version += 1;

  const [patch] = proposePatches(graph);
  assert.equal(patch.id.startsWith("patch-umbrella"), true);
  assert.equal(patch.preserves.includes("summon-ducks"), true);

  const repaired = applyPatch(graph, patch);
  const result = simulateCast(repaired);
  assert.equal(result.success, true);
  assert.equal(result.assertions.ducksPresent, true);
  assert.equal(result.assertions.roomFlooded, false);
  assert.equal(result.assertions.flowerBloomed, true);
});

test("without a sacred constraint the minimal repair removes the ducks", () => {
  const graph = createMoonflowerScenario();
  const [patch] = proposePatches(graph);
  assert.equal(patch.id.startsWith("patch-direct"), true);
  assert.equal(patch.tradeoffs.includes("The ducks disappear from the spell"), true);

  const repaired = applyPatch(graph, patch);
  const result = simulateCast(repaired);
  assert.equal(result.success, true);
  assert.equal(result.assertions.ducksPresent, false);
  assert.equal(result.assertions.roomFlooded, false);
});

test("patches reject stale graph versions", () => {
  const graph = createMoonflowerScenario();
  const patch = proposePatches(graph)[0];
  graph.version += 1;
  assert.throws(() => applyPatch(graph, patch), /Stale patch/);
});
