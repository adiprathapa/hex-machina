import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { proposePatches } from "../src/solver/repair.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { createResonantAviaryScenario } from "../src/scenarios/resonant-aviary.ts";

const client = await readFile(new URL("../app/HexMachina.tsx", import.meta.url), "utf8");

test("the patch review card never asserts a protection the graph does not have", () => {
  // The footer was the literal string "Locked: ducks remain sacred", with no
  // dependency on graph.constraints or patch.preserves. On a fresh graph the
  // top-ranked repair is the one that deletes the ducks, so the human was
  // promised the exact thing the patch they were approving would destroy.
  assert.equal(
    /Locked: ducks remain sacred/.test(client),
    false,
    "the review card must not hardcode a protection claim",
  );
  assert.match(client, /patch\.preserves/, "the card must read the patch's own preserved list");
});

test("the review card shows the human what the repair gives up", () => {
  assert.match(client, /patch\.tradeoffs/, "tradeoffs must reach the human, not only the agent");
  assert.match(client, /data-preserving=\{patch\.preserves\.length > 0\}/);
});

test("the top-ranked repair on an unconstrained graph really does destroy the protected rune", () => {
  // This is why the honesty matters rather than being cosmetic: the default
  // selection is the destructive one until a constraint is locked.
  for (const scenario of [createMoonflowerScenario(), createResonantAviaryScenario()]) {
    const [top] = proposePatches(scenario);
    assert.ok(top, "an unconstrained graph must still offer a repair");
    assert.equal(scenario.constraints.length, 0, "the fixture starts with nothing locked");
    assert.deepEqual(top.preserves, [], "the top-ranked repair preserves nothing");
    assert.ok(
      top.tradeoffs.length > 0,
      "the destructive repair must declare what it costs, so the card has something honest to show",
    );
  }
});

test("a locked constraint changes both the offered repair and what the card can claim", async () => {
  const scenario = createMoonflowerScenario();
  const locked = {
    ...scenario,
    constraints: [{
      id: "sacred-ducks",
      targetId: scenario.semantics.roles.subject,
      targetType: "node",
      requirement: "preserve",
      reason: "The ducks are funny. They stay.",
    }],
  };

  const [top] = proposePatches(locked);
  assert.ok(top.preserves.length > 0, "with a lock set, the offered repair preserves something");
  assert.notDeepEqual(
    top.operations,
    proposePatches(scenario)[0].operations,
    "the human's constraint must change which repair is offered",
  );
});
