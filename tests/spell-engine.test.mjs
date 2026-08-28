import assert from "node:assert/strict";
import test from "node:test";

import { applyPatch, connectRunes, getValidEdgeTypes, serializeSpellGraph, validateSpellGraph } from "../src/domain/spell.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { simulateCast } from "../src/simulator/cast.ts";
import { proposePatches } from "../src/solver/repair.ts";

test("moonflower fixture is valid and serializes deterministically", () => {
  const graph = createMoonflowerScenario();
  assert.deepEqual(validateSpellGraph(graph), []);
  assert.equal(serializeSpellGraph(graph), serializeSpellGraph(graph));
  assert.equal(graph.nodes.length, 12);
  assert.equal(graph.nodes.filter((node) => node.dormant).length, 6);
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
  assert.equal(patch.searchEvidence.rank, 1);
  assert.equal(patch.searchEvidence.editCount, 8);
  assert.equal(patch.searchEvidence.candidateCount, 2);
  assert.equal(patch.searchEvidence.eligibleCandidateCount, 1);
  assert.deepEqual(patch.searchEvidence.constraintsSatisfied, ["sacred-summon-ducks"]);

  const repaired = applyPatch(graph, patch);
  const result = simulateCast(repaired);
  assert.equal(result.success, true);
  assert.equal(result.assertions.ducksPresent, true);
  assert.equal(result.assertions.duckCount, 12);
  assert.equal(result.assertions.roomFlooded, false);
  assert.equal(result.assertions.flowerBloomed, true);
  assert.match(result.summary, /twelve umbrella-equipped ducks/);
});

test("without a sacred constraint the minimal repair removes the ducks", () => {
  const graph = createMoonflowerScenario();
  const patches = proposePatches(graph);
  const [patch] = patches;
  assert.equal(patches.length, 2);
  assert.equal(patch.id.startsWith("patch-direct"), true);
  assert.equal(patch.searchEvidence.rank, 1);
  assert.equal(patch.searchEvidence.editCount, 6);
  assert.equal(patches[1].searchEvidence.rank, 2);
  assert.equal(patches[1].searchEvidence.editCount, 8);
  assert.equal(patch.tradeoffs.includes("The ducks disappear from the spell"), true);

  const repaired = applyPatch(graph, patch);
  const result = simulateCast(repaired);
  assert.equal(result.success, true);
  assert.equal(result.assertions.ducksPresent, false);
  assert.equal(result.assertions.duckCount, 0);
  assert.equal(result.assertions.roomFlooded, false);
  assert.match(result.summary, /reaches the Moonflower directly/);
});

test("atomic patch application rejects a solver bug that severs a sacred rune", () => {
  const graph = createMoonflowerScenario();
  graph.constraints.push({
    id: "sacred-summon-ducks",
    targetId: "summon-ducks",
    targetType: "node",
    requirement: "preserve",
    reason: "The ducks are funny.",
  });
  graph.version += 1;

  const unsafe = proposePatches(createMoonflowerScenario())[0];
  unsafe.expectedVersion = graph.version;
  assert.throws(
    () => applyPatch(graph, unsafe),
    /Sacred constraint sacred-summon-ducks would be violated/,
  );
  assert.equal(graph.version, 2);
});

test("patches reject stale graph versions", () => {
  const graph = createMoonflowerScenario();
  const patch = proposePatches(graph)[0];
  graph.version += 1;
  assert.throws(() => applyPatch(graph, patch), /Stale patch/);
});

test("manual editing exposes typed compatibility and applies a validated connection", () => {
  const graph = createMoonflowerScenario();
  assert.deepEqual(getValidEdgeTypes("verb", "target"), ["targets"]);
  assert.deepEqual(getValidEdgeTypes("source", "target"), []);

  const edited = connectRunes(graph, "pour", "moonflower", "targets");
  assert.equal(edited.version, graph.version + 1);
  assert.equal(edited.edges.some((edge) => edge.from === "pour" && edge.to === "moonflower" && edge.type === "targets"), true);
  assert.deepEqual(validateSpellGraph(edited), []);
  assert.equal(graph.edges.some((edge) => edge.from === "pour" && edge.to === "moonflower"), false);
});

test("manual editing rejects invalid and duplicate connections without mutation", () => {
  const graph = createMoonflowerScenario();
  assert.throws(() => connectRunes(graph, "moonwell", "room", "targets"), /Invalid targets connection/);
  assert.throws(() => connectRunes(graph, "pour", "room", "targets"), /already connected/);
  assert.equal(graph.version, 1);
  assert.equal(graph.edges.length, 4);
});

test("connecting a dormant workshop rune activates it atomically", () => {
  const graph = createMoonflowerScenario();
  const edited = connectRunes(graph, "summon-ducks", "umbrella", "flows_to");
  assert.equal(edited.nodes.find((node) => node.id === "umbrella")?.dormant, false);
  assert.equal(graph.nodes.find((node) => node.id === "umbrella")?.dormant, true);
});
