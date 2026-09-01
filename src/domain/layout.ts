import type { SpellGraph } from "./spell.ts";

/**
 * Minimum centre separation between two runes, as a percentage of the canvas.
 * A rune is at most ~28% of the narrowest supported canvas wide and ~14% tall,
 * so a pair clears if it is separated on either axis.
 */
const MIN_SEPARATION_X = 29.5;
const MIN_SEPARATION_Y = 14.5;
const LAYOUT_BOUNDS = { minX: 7, maxX: 93, minY: 7, maxY: 90 };

/**
 * Pushes overlapping runes apart in place. Layout jitter is what makes variants
 * visually distinct, but applied to a hand-authored layout it can slide two
 * runes on top of each other, which reads as a rendering bug. This runs after
 * the jitter and is fully deterministic: fixed pass count, fixed iteration
 * order, no randomness, and it only moves runes that actually collide, so a
 * well-separated layout comes through unchanged.
 */
export function relaxLayoutOverlaps(nodes: SpellGraph["nodes"]) {
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));

  for (let pass = 0; pass < 200; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const gapX = MIN_SEPARATION_X - Math.abs(dx);
        const gapY = MIN_SEPARATION_Y - Math.abs(dy);
        if (gapX <= 0 || gapY <= 0) continue;

        moved = true;
        // Separate along whichever axis needs the smaller correction, so the
        // authored left-to-right causal reading order survives.
        // A rune pinned against the canvas edge cannot absorb its half of the
        // push, so hand the remainder to its partner. Without this the pair
        // just stacks up against the boundary.
        const separate = (axis: "x" | "y", amount: number, low: number, high: number) => {
          const before = { a: a[axis], b: b[axis] };
          a[axis] = clamp(before.a - amount, low, high);
          b[axis] = clamp(before.b + amount, low, high);
          const residual = (before.a - amount - a[axis]) + (before.b + amount - b[axis]);
          if (residual > 0) a[axis] = clamp(a[axis] - residual, low, high);
          else if (residual < 0) b[axis] = clamp(b[axis] - residual, low, high);
        };

        if (gapX <= gapY * (MIN_SEPARATION_X / MIN_SEPARATION_Y)) {
          separate("x", (gapX / 2 + 0.5) * (dx < 0 ? -1 : 1), LAYOUT_BOUNDS.minX, LAYOUT_BOUNDS.maxX);
        } else {
          separate("y", (gapY / 2 + 0.5) * (dy < 0 ? -1 : 1), LAYOUT_BOUNDS.minY, LAYOUT_BOUNDS.maxY);
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Evens the spacing of a layout so runes fill the canvas instead of leaving
 * an empty band through the middle. The hand-authored skeleton every scenario
 * shares (and the family generator jitters) keeps its runes on three rows,
 * which leaves a 20-unit void at y 43-63 and a pocket at x 30-66 / y 9-25;
 * the bounding box already spans the whole authored box, so rescaling cannot
 * close those gaps. This is a short centroidal (Lloyd) pass instead: a fixed
 * sample grid over the authored bounds is assigned to the nearest rune, using
 * the same anisotropic distance the overlap relaxer separates on, and each
 * rune slides part of the way toward the centroid of its cell.
 *
 * The causal reading order is left to right, so a rune's x movement is capped:
 * at most `X_CAP` units (which keeps the ~20-unit causal columns), and never
 * more than half the distance to the nearest rune that started at least
 * `ORDER_GAP` units away on x, so two runes that began in different columns
 * can never trade places (runes sharing a column may move together). The
 * layout is relaxed before the pass so the caps anchor to a legal layout, and
 * `relaxLayoutOverlaps` runs again afterwards so no two runes collide. Fully
 * deterministic: fixed iteration count, fixed sample grid, fixed node order,
 * no randomness.
 */
export function fillLayout(nodes: SpellGraph["nodes"]) {
  const ITERATIONS = 24;
  const BLEND = 0.6;
  const X_CAP = 8;
  const ORDER_GAP = 1;
  const SAMPLES_X = 43;
  const SAMPLES_Y = 42;
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));

  relaxLayoutOverlaps(nodes);

  const anchor = nodes.map((node) => ({ x: node.x, y: node.y }));
  const xCap = anchor.map((own, k) => {
    let cap = X_CAP;
    anchor.forEach((other, j) => {
      const gap = Math.abs(own.x - other.x);
      if (j !== k && gap >= ORDER_GAP) cap = Math.min(cap, (gap - 1) / 2);
    });
    return Math.max(0, cap);
  });

  const spanX = LAYOUT_BOUNDS.maxX - LAYOUT_BOUNDS.minX;
  const spanY = LAYOUT_BOUNDS.maxY - LAYOUT_BOUNDS.minY;

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const cells = nodes.map(() => ({ x: 0, y: 0, count: 0 }));
    for (let i = 0; i <= SAMPLES_X; i += 1) {
      for (let j = 0; j <= SAMPLES_Y; j += 1) {
        const px = LAYOUT_BOUNDS.minX + (i / SAMPLES_X) * spanX;
        const py = LAYOUT_BOUNDS.minY + (j / SAMPLES_Y) * spanY;
        let nearest = 0;
        let nearestDistance = Infinity;
        for (let k = 0; k < nodes.length; k += 1) {
          const dx = (nodes[k].x - px) / MIN_SEPARATION_X;
          const dy = (nodes[k].y - py) / MIN_SEPARATION_Y;
          const distance = dx * dx + dy * dy;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = k;
          }
        }
        cells[nearest].x += px;
        cells[nearest].y += py;
        cells[nearest].count += 1;
      }
    }
    for (let k = 0; k < nodes.length; k += 1) {
      const cell = cells[k];
      if (!cell.count) continue;
      const node = nodes[k];
      const targetX = node.x + (cell.x / cell.count - node.x) * BLEND;
      const targetY = node.y + (cell.y / cell.count - node.y) * BLEND;
      node.x = clamp(
        clamp(targetX, anchor[k].x - xCap[k], anchor[k].x + xCap[k]),
        LAYOUT_BOUNDS.minX,
        LAYOUT_BOUNDS.maxX,
      );
      node.y = clamp(targetY, LAYOUT_BOUNDS.minY, LAYOUT_BOUNDS.maxY);
    }
  }

  relaxLayoutOverlaps(nodes);
}
