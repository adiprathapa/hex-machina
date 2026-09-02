import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchPreview } from "../src/domain/patch-preview.ts";
import { applyPatch, cloneGraph, connectRunes, getValidEdgeTypes, serializeSpellGraph, validateSpellGraph } from "../src/domain/spell.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { createResonantAviaryScenario } from "../src/scenarios/resonant-aviary.ts";
import { createClockworkOrchardScenario } from "../src/scenarios/clockwork-orchard.ts";
import { simulateCast } from "../src/simulator/cast.ts";
import { explainFlood, proposePatches } from "../src/solver/repair.ts";
import { traceSpellGraph } from "../src/solver/trace.ts";

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
  assert.deepEqual(first.sideEffects[0].responsibleNodeIds, ["moonwell", "multiply", "summon-ducks", "pour", "room"]);
  assert.deepEqual(first.sideEffects[0].responsibleEdgeIds, ["e-water-multiply", "e-multiply-ducks", "e-ducks-pour", "e-pour-room"]);
});

test("resonant aviary exposes a minimal feedback-cycle failure and preserving repair", () => {
  const graph = createResonantAviaryScenario();
  assert.deepEqual(validateSpellGraph(graph), []);
  const failed = simulateCast(graph);
  assert.equal(failed.success, false);
  assert.equal(failed.assertions.thunderbirdsPresent, true);
  assert.equal(failed.assertions.feedbackLoopActive, true);
  assert.equal(failed.assertions.domeShattered, true);
  assert.equal(failed.sideEffects[0].responsibleEdgeIds.length, 5);

  const explanation = explainFlood(graph);
  assert.equal(explanation.ruleEvidence.ruleId, "resonant-feedback-cycle");
  assert.equal(explanation.ruleEvidence.allPremisesSatisfied, true);
  assert.equal(explanation.minimality.everyResponsibleEdgeNecessary, true);
  assert.equal(explanation.ruleEvidence.premises.some((premise) => premise.id === "song-feeds-back-into-echo"), true);

  graph.constraints.push({
    id: "keep-thunderbirds",
    targetId: graph.semantics.roles.subject,
    targetType: "node",
    requirement: "preserve",
    reason: "The thunderbirds are the choir. They stay.",
  });
  const patches = proposePatches(graph);
  assert.equal(patches.length, 1);
  assert.match(patches[0].id, /^patch-dampener/);
  const repaired = simulateCast(applyPatch(graph, patches[0]));
  assert.equal(repaired.success, true);
  assert.equal(repaired.assertions.thunderbirdsPresent, true);
  assert.equal(repaired.assertions.feedbackLoopActive, false);
  assert.equal(repaired.assertions.harmonyComplete, true);
});

test("resonant direct repair removes the cyclic choir when it is not sacred", () => {
  const graph = createResonantAviaryScenario();
  const patch = proposePatches(graph)[0];
  assert.match(patch.id, /^patch-direct/);
  assert.equal(patch.operations.length, 7);
  const repaired = simulateCast(applyPatch(graph, patch));
  assert.equal(repaired.success, true);
  assert.equal(repaired.assertions.thunderbirdsPresent, false);
  assert.equal(repaired.assertions.feedbackLoopActive, false);
  assert.equal(repaired.assertions.harmonyComplete, true);
});

test("clockwork orchard exposes an edge-minimal temporal failure and preserving repair", () => {
  const graph = createClockworkOrchardScenario();
  assert.deepEqual(validateSpellGraph(graph), []);
  const failed = simulateCast(graph);
  assert.equal(failed.success, false);
  assert.equal(failed.assertions.mothsPresent, true);
  assert.equal(failed.assertions.prematureAction, true);
  assert.equal(failed.assertions.bloomBruised, true);

  const explanation = explainFlood(graph);
  assert.equal(explanation.ruleEvidence.ruleId, "unguarded-premature-action");
  assert.equal(explanation.ruleEvidence.allPremisesSatisfied, true);
  assert.equal(explanation.minimality.everyResponsibleEdgeNecessary, true);
  assert.equal(explanation.ruleEvidence.premises.some((premise) => premise.id === "no-after-dawn-requirement"), true);

  graph.constraints.push({
    id: "keep-moths",
    targetId: graph.semantics.roles.subject,
    targetType: "node",
    requirement: "preserve",
    reason: "The clockwork moths are beautiful. They stay.",
  });
  const patches = proposePatches(graph);
  assert.equal(patches.length, 1);
  assert.match(patches[0].id, /^patch-temporal-guard/);
  const repaired = simulateCast(applyPatch(graph, patches[0]));
  assert.equal(repaired.success, true);
  assert.equal(repaired.assertions.mothsPresent, true);
  assert.equal(repaired.assertions.dawnGuardActive, true);
  assert.equal(repaired.assertions.seedsSet, true);
});

test("clockwork orchard direct repair removes the moth branch when it is not sacred", () => {
  const graph = createClockworkOrchardScenario();
  const patch = proposePatches(graph)[0];
  assert.match(patch.id, /^patch-direct/);
  const repaired = simulateCast(applyPatch(graph, patch));
  assert.equal(repaired.success, true);
  assert.equal(repaired.assertions.mothsPresent, false);
  assert.equal(repaired.assertions.prematureAction, false);
  assert.equal(repaired.assertions.seedsSet, true);
});

test("side-effect explanation proves a typed edge-minimal causal subgraph", () => {
  const graph = createMoonflowerScenario();
  const before = JSON.stringify(graph);
  const explanation = explainFlood(graph);

  assert.equal(explanation.present, true);
  assert.deepEqual(explanation.subgraph.nodes.map((node) => node.id), [
    "moonwell", "multiply", "summon-ducks", "pour", "room",
  ]);
  assert.deepEqual(explanation.subgraph.edges.map((edge) => edge.id), [
    "e-water-multiply", "e-multiply-ducks", "e-ducks-pour", "e-pour-room",
  ]);
  assert.deepEqual(explanation.causalSteps.map((step) => [step.from.nodeId, step.to.nodeId]), [
    ["moonwell", "multiply"],
    ["multiply", "summon-ducks"],
    ["summon-ducks", "pour"],
    ["pour", "room"],
  ]);
  assert.equal(explanation.ruleEvidence.allPremisesSatisfied, true);
  assert.equal(explanation.ruleEvidence.premises.length, 5);
  assert.equal(explanation.ruleEvidence.premises.at(-1).id, "no-protective-umbrella-route");
  assert.equal(explanation.ruleEvidence.premises.at(-1).satisfied, true);
  assert.equal(explanation.minimality.complete, true);
  assert.equal(explanation.minimality.everyResponsibleEdgeNecessary, true);
  assert.equal(explanation.minimality.necessityChecks.length, 4);
  assert.equal(explanation.minimality.necessityChecks.every((check) => !check.sideEffectStillPresent), true);
  assert.equal(JSON.stringify(graph), before, "explanation and counterfactual checks must not mutate the graph");

  const repaired = applyPatch(graph, proposePatches(graph)[0]);
  const absent = explainFlood(repaired);
  assert.equal(absent.present, false);
  assert.deepEqual(absent.subgraph, { graphVersion: 2, nodes: [], edges: [] });
  assert.equal(absent.minimality.applicable, false);
});

test("effect tracing returns a bounded ordered causal path with complete graph evidence", () => {
  const graph = createMoonflowerScenario();
  const trace = traceSpellGraph(graph, {
    effectId: "flooded-observatory",
    maxDepth: 8,
    maxPaths: 3,
  });
  assert.equal(trace.present, true);
  assert.deepEqual(trace.query, { kind: "effect", id: "flooded-observatory" });
  assert.deepEqual(trace.paths, [{
    pathIndex: 1,
    nodeIds: ["moonwell", "multiply", "summon-ducks", "pour", "room"],
    edgeIds: ["e-water-multiply", "e-multiply-ducks", "e-ducks-pour", "e-pour-room"],
    depth: 4,
    terminalNodeId: "room",
    complete: true,
  }]);
  assert.deepEqual(trace.responsibleNodeIds, trace.paths[0].nodeIds);
  assert.deepEqual(trace.responsibleEdgeIds, trace.paths[0].edgeIds);
  assert.deepEqual(trace.cycles, []);
  assert.deepEqual(trace.typeViolations, []);
  assert.equal(trace.truncated, false);
});

test("source tracing enforces depth bounds and reports cycles and type violations", () => {
  const bounded = traceSpellGraph(createMoonflowerScenario(), {
    sourceId: "moonwell",
    maxDepth: 2,
    maxPaths: 1,
  });
  assert.deepEqual(bounded.paths[0].nodeIds, ["moonwell", "multiply", "summon-ducks"]);
  assert.equal(bounded.paths[0].complete, false);
  assert.equal(bounded.truncated, true);
  assert.deepEqual(bounded.bounds, { maxDepth: 2, maxPaths: 1 });

  const cyclic = createMoonflowerScenario();
  cyclic.edges.push({ id: "e-cycle-pour-multiply", from: "pour", to: "multiply", type: "flows_to" });
  const evidence = traceSpellGraph(cyclic, {
    sourceId: "moonwell",
    maxDepth: 8,
    maxPaths: 3,
  });
  assert.deepEqual(evidence.cycles, [{
    nodeIds: ["multiply", "summon-ducks", "pour", "multiply"],
    edgeIds: ["e-multiply-ducks", "e-ducks-pour", "e-cycle-pour-multiply"],
  }]);
  const invalid = createMoonflowerScenario();
  invalid.edges.push({ id: "e-invalid-room-water", from: "room", to: "moonwell", type: "targets" });
  const invalidEvidence = traceSpellGraph(invalid, {
    sourceId: "moonwell",
    maxDepth: 8,
    maxPaths: 3,
  });
  assert.equal(invalidEvidence.typeViolations.some((problem) => /Invalid targets connection: target -> source/.test(problem)), true);
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
  assert.deepEqual(patch.preconditions, {
    expectedGraphVersion: 2,
    requiredEdgeIds: ["e-ducks-pour", "e-pour-room"],
    requiredDormantNodeIds: ["umbrella", "bloom"],
    requiredConstraintIds: ["sacred-summon-ducks"],
  });

  const repaired = applyPatch(graph, patch);
  const result = simulateCast(repaired);
  assert.equal(result.success, true);
  assert.equal(result.assertions.ducksPresent, true);
  assert.equal(result.assertions.duckCount, 12);
  assert.equal(result.assertions.roomFlooded, false);
  assert.equal(result.assertions.flowerBloomed, true);
  assert.match(result.summary, /twelve umbrella-equipped ducks/);
});

test("constraint-aware repairs expose every structural edit as a human-readable preview", () => {
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
  const preview = buildPatchPreview(graph, patch);
  assert.equal(preview.length, patch.operations.length);
  assert.deepEqual(
    preview.map((entry) => entry.kind),
    ["disconnect", "disconnect", "awaken", "connect", "connect", "connect", "awaken", "connect"],
  );
  assert.deepEqual(
    preview.map((entry) => entry.label),
    [
      "Disconnect Summon ducks → Pour (flows to)",
      "Disconnect Pour → The room (targets)",
      "Awaken Umbrella",
      "Connect Summon ducks → Umbrella (flows to)",
      "Connect Umbrella → Pour (flows to)",
      "Connect Pour → Moonflower (targets)",
      "Awaken Bloom",
      "Connect Moonflower → Bloom (flows to)",
    ],
  );
  assert.deepEqual(preview.filter((entry) => entry.kind === "disconnect").map((entry) => entry.edgeId), ["e-ducks-pour", "e-pour-room"]);
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
  assert.deepEqual(patch.preconditions, {
    expectedGraphVersion: 1,
    requiredEdgeIds: ["e-water-multiply", "e-pour-room"],
    requiredDormantNodeIds: ["bloom"],
    requiredConstraintIds: [],
  });

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
  unsafe.preconditions.expectedGraphVersion = graph.version;
  unsafe.preconditions.requiredConstraintIds = ["sacred-summon-ducks"];
  assert.throws(
    () => applyPatch(graph, unsafe),
    /Sacred constraint sacred-summon-ducks would be violated/,
  );
  assert.equal(graph.version, 2);
});

test("patch application fails closed when same-version structural preconditions drift", () => {
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

  const missingEdge = cloneGraph(graph);
  missingEdge.edges = missingEdge.edges.filter((edge) => edge.id !== "e-ducks-pour");
  const missingEdgeSnapshot = JSON.stringify(missingEdge);
  assert.throws(() => applyPatch(missingEdge, patch), /required edge e-ducks-pour is missing/);
  assert.equal(JSON.stringify(missingEdge), missingEdgeSnapshot);

  const awakenedEarly = cloneGraph(graph);
  awakenedEarly.nodes.find((node) => node.id === "umbrella").dormant = false;
  const awakenedSnapshot = JSON.stringify(awakenedEarly);
  assert.throws(() => applyPatch(awakenedEarly, patch), /rune umbrella is no longer dormant/);
  assert.equal(JSON.stringify(awakenedEarly), awakenedSnapshot);

  const lostConstraint = cloneGraph(graph);
  lostConstraint.constraints = [];
  const constraintSnapshot = JSON.stringify(lostConstraint);
  assert.throws(() => applyPatch(lostConstraint, patch), /sacred constraint sacred-summon-ducks is missing/);
  assert.equal(JSON.stringify(lostConstraint), constraintSnapshot);
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
