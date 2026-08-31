import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  generateAgentGymScenarioForFamily,
} from "../src/scenarios/agent-gym-family.ts";

// Layout jitter is what makes the 96 variants visually distinct, but applied to
// a hand-authored layout it used to slide runes on top of one another — at
// 1280px, 151 overlapping pairs across the three families. The generator now
// relaxes the layout after jittering it. These floors sit below the separation
// the relaxer targets and well above the point where runes visibly collide, so
// they catch a regression that weakens or drops the relaxation pass without
// failing on the ordinary variation between variants.
const MIN_DX = 25;
const MIN_DY = 9.5;

test("every generated variant lays its runes out without overlap", () => {
  const collisions = [];
  let variants = 0;

  for (const familyId of Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES)) {
    for (const [split, size] of Object.entries(AGENT_GYM_FAMILY_SPLIT_SIZES[familyId])) {
      for (let index = 0; index < size; index += 1) {
        const { graph } = generateAgentGymScenarioForFamily(familyId, split, index);
        variants += 1;

        for (let a = 0; a < graph.nodes.length; a += 1) {
          for (let b = a + 1; b < graph.nodes.length; b += 1) {
            const dx = Math.abs(graph.nodes[a].x - graph.nodes[b].x);
            const dy = Math.abs(graph.nodes[a].y - graph.nodes[b].y);
            if (dx < MIN_DX && dy < MIN_DY) {
              collisions.push(
                `${familyId}/${split}/${index}: ${graph.nodes[a].label} and ${graph.nodes[b].label}`
                + ` are ${dx.toFixed(1)}x${dy.toFixed(1)} apart`,
              );
            }
          }
        }
      }
    }
  }

  assert.equal(variants, 96, "all three families contribute their full split sizes");
  assert.deepEqual(collisions, [], "no generated variant places two runes on top of each other");
});

test("relaxation keeps every rune inside the canvas the renderer maps from", () => {
  for (const familyId of Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES)) {
    for (const [split, size] of Object.entries(AGENT_GYM_FAMILY_SPLIT_SIZES[familyId])) {
      for (let index = 0; index < size; index += 1) {
        const { graph } = generateAgentGymScenarioForFamily(familyId, split, index);
        for (const node of graph.nodes) {
          assert.ok(node.x >= 7 && node.x <= 93, `${node.label} x ${node.x} is inside the authored bounds`);
          assert.ok(node.y >= 7 && node.y <= 90, `${node.label} y ${node.y} is inside the authored bounds`);
        }
      }
    }
  }
});

test("generated layouts are deterministic", () => {
  const first = generateAgentGymScenarioForFamily("family-03-v1", "test", 1).graph.nodes.map((n) => [n.x, n.y]);
  const second = generateAgentGymScenarioForFamily("family-03-v1", "test", 1).graph.nodes.map((n) => [n.x, n.y]);
  assert.deepEqual(first, second, "the relaxation pass introduces no randomness");
});
