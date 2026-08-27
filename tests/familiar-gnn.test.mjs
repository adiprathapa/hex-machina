import assert from "node:assert/strict";
import test from "node:test";

import { applyPatch } from "../src/domain/spell.ts";
import { inferFamiliar } from "../src/familiar/gnn.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { simulateCast } from "../src/simulator/cast.ts";
import { proposePatches } from "../src/solver/repair.ts";

test("Familiar deterministically ranks Multiply as the failed spell's leading suspect", () => {
  const graph = createMoonflowerScenario();
  const cast = simulateCast(graph);
  const first = inferFamiliar(graph, cast);
  const second = inferFamiliar(graph, cast);

  assert.deepEqual(first, second);
  assert.equal(first.status, "anomaly");
  assert.equal(first.advisory, true);
  assert.equal(first.authoritative, false);
  assert.equal(first.rounds, 2);
  assert.equal(first.ranking.length, 3);
  assert.equal(first.ranking[0].nodeId, "multiply");
  assert.equal(first.ranking[0].probability > first.ranking[1].probability, true);
  assert.equal(first.ranking[0].signals.includes("amplifier-shaped modifier prior"), true);
});

test("Familiar emits no suspect ranking after the verified repair", () => {
  const graph = createMoonflowerScenario();
  graph.constraints.push({
    id: "sacred-summon-ducks",
    targetId: "summon-ducks",
    targetType: "node",
    requirement: "preserve",
    reason: "The ducks are funny.",
  });
  graph.version += 1;

  const repaired = applyPatch(graph, proposePatches(graph)[0]);
  const prediction = inferFamiliar(repaired, simulateCast(repaired));
  assert.equal(prediction.status, "stable");
  assert.deepEqual(prediction.ranking, []);
});
