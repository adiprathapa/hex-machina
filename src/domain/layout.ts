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

