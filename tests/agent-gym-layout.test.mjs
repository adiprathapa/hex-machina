import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  generateAgentGymScenarioForFamily,
} from "../src/scenarios/agent-gym-family.ts";
import { createClockworkOrchardScenario } from "../src/scenarios/clockwork-orchard.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";
import { createResonantAviaryScenario } from "../src/scenarios/resonant-aviary.ts";

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

// The shared skeleton left an empty band across the middle of the canvas
// (authored y 43-63) and a pocket at x 30-66 / y 9-25 in every scenario. The
// generator and the base scenarios now run a centroidal fill pass before the
// relaxer. This test renders each layout the way HexMachina does at 1920x1080
// (a 1034x839 canvas, 181x87 runes, the same inset formula) and bounds the
// two void metrics the product owner's complaint was measured with: the
// largest empty circle (distance from a point to the nearest rune box or
// canvas edge, in rune heights) and the largest empty axis-aligned rectangle
// (as a fraction of the canvas). Measured at this geometry across the 96
// variants before the fill pass: circle 1.70 mean / 2.06 max rune heights,
// rectangle 14.6% mean / 20.8% max (the base moonflower: 1.64 and 17.1%).
// After it: 1.39 / 1.66 and 9.0% / 11.7% (base moonflower: 1.31 and 8.6%).
// The thresholds sit just above the new maxima, so the test fails on the old
// layout and on any change that drops or weakens the fill pass.
const CANVAS = { width: 1034, height: 839 };
const RUNE = { width: 181, height: 87 };
const AUTHORED = { minX: 7, maxX: 93, minY: 7, maxY: 90 };
const MAX_EMPTY_CIRCLE_RUNE_HEIGHTS = 1.75;
const MAX_EMPTY_RECT_FRACTION = 0.15;

function runeBoxes(nodes) {
  // Mirrors HexMachina's inset: the widest rune is at least 1.15x the
  // stylesheet width, and the canvas keeps half a rune plus a margin clear.
  const widest = RUNE.width * 1.15;
  const horizontalInset = Math.min(22, Math.max(8, ((widest / 2 + 10) / CANVAS.width) * 100));
  const verticalInset = Math.min(16, Math.max(5, ((RUNE.height / 2 + 8) / CANVAS.height) * 100));
  return nodes.map((node) => {
    const px = (horizontalInset
      + ((node.x - AUTHORED.minX) / (AUTHORED.maxX - AUTHORED.minX)) * (100 - horizontalInset * 2))
      / 100 * CANVAS.width;
    const py = (verticalInset
      + ((node.y - AUTHORED.minY) / (AUTHORED.maxY - AUTHORED.minY)) * (100 - verticalInset * 2))
      / 100 * CANVAS.height;
    return {
      left: px - RUNE.width / 2,
      right: px + RUNE.width / 2,
      top: py - RUNE.height / 2,
      bottom: py + RUNE.height / 2,
    };
  });
}

function largestEmptyCircle(boxes) {
  const step = 6;
  let best = 0;
  for (let y = 0; y <= CANVAS.height; y += step) {
    for (let x = 0; x <= CANVAS.width; x += step) {
      let distance = Math.min(x, y, CANVAS.width - x, CANVAS.height - y);
      for (const box of boxes) {
        const dx = Math.max(box.left - x, 0, x - box.right);
        const dy = Math.max(box.top - y, 0, y - box.bottom);
        distance = Math.min(distance, Math.hypot(dx, dy));
        if (distance <= best) break;
      }
      if (distance > best) best = distance;
    }
  }
  return best / RUNE.height;
}

function largestEmptyRectangle(boxes) {
  const cell = 4;
  const columns = Math.floor(CANVAS.width / cell);
  const rows = Math.floor(CANVAS.height / cell);
  const occupied = new Uint8Array(columns * rows);
  for (const box of boxes) {
    for (let y = Math.max(0, Math.floor(box.top / cell)); y < Math.min(rows, Math.ceil(box.bottom / cell)); y += 1) {
      for (let x = Math.max(0, Math.floor(box.left / cell)); x < Math.min(columns, Math.ceil(box.right / cell)); x += 1) {
        occupied[y * columns + x] = 1;
      }
    }
  }
  const heights = new Int32Array(columns);
  let best = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) heights[x] = occupied[y * columns + x] ? 0 : heights[x] + 1;
    const stack = [];
    for (let x = 0; x <= columns; x += 1) {
      const height = x < columns ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][1] > height) {
        const [from, tall] = stack.pop();
        best = Math.max(best, tall * (x - from));
        start = from;
      }
      stack.push([start, height]);
    }
  }
  return (best * cell * cell) / (CANVAS.width * CANVAS.height);
}

test("every layout fills its canvas without a large interior void", () => {
  const layouts = [
    ["moonflower", createMoonflowerScenario().nodes],
    ["clockwork-orchard", createClockworkOrchardScenario().nodes],
    ["resonant-aviary", createResonantAviaryScenario().nodes],
  ];
  for (const familyId of Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES)) {
    for (const [split, size] of Object.entries(AGENT_GYM_FAMILY_SPLIT_SIZES[familyId])) {
      for (let index = 0; index < size; index += 1) {
        layouts.push([`${familyId}/${split}/${index}`, generateAgentGymScenarioForFamily(familyId, split, index).graph.nodes]);
      }
    }
  }
  assert.equal(layouts.length, 99, "three base scenarios plus all 96 generated variants");

  const failures = [];
  for (const [name, nodes] of layouts) {
    const boxes = runeBoxes(nodes);
    const circle = largestEmptyCircle(boxes);
    const rect = largestEmptyRectangle(boxes);
    if (circle > MAX_EMPTY_CIRCLE_RUNE_HEIGHTS) {
      failures.push(`${name}: largest empty circle is ${circle.toFixed(2)} rune heights`);
    }
    if (rect > MAX_EMPTY_RECT_FRACTION) {
      failures.push(`${name}: largest empty rectangle is ${(rect * 100).toFixed(1)}% of the canvas`);
    }
  }
  assert.deepEqual(failures, [], "no layout leaves a void the fill pass should have closed");
});
