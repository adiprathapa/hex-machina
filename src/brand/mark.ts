/**
 * The one brand mark, shared by the interface header, the favicon and the
 * social card so they cannot drift apart. A solid hexagon with the product's
 * subject knocked out of it: a three-node causal path. Solid rather than
 * outlined because an outline vanishes at the 16px a browser tab gives it,
 * while the header at 30px had been drawn thin and the tab icon thick.
 *
 * Coordinates are in a 32-unit box. Renderers pass the ink colour and the
 * ground colour the knock-out should show.
 */
export const BRAND_MARK_VIEWBOX = "0 0 32 32";
export const BRAND_MARK_HEX = "M16 2.6 27.2 9v14L16 29.4 4.8 23V9z";
export const BRAND_MARK_EDGES = "M10.6 20.6 16 12.2l5.4 5";
export const BRAND_MARK_NODES: ReadonlyArray<readonly [number, number]> = [
  [10.6, 20.6],
  [16, 12.2],
  [21.4, 17.2],
];
/** Stroke on the hexagon fill, so its corners round the way the path ends do. */
export const BRAND_MARK_CORNER = 2;
export const BRAND_MARK_EDGE_WIDTH = 2.2;
export const BRAND_MARK_NODE_RADIUS = 2.3;

/** Standalone SVG markup for the asset renderer. */
export function brandMarkSvg(size: number, ink: string, ground: string) {
  const nodes = BRAND_MARK_NODES
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${BRAND_MARK_NODE_RADIUS}" fill="${ground}"/>`)
    .join("");
  return `<svg viewBox="${BRAND_MARK_VIEWBOX}" width="${size}" height="${size}">`
    + `<path d="${BRAND_MARK_HEX}" fill="${ink}" stroke="${ink}" stroke-width="${BRAND_MARK_CORNER}" stroke-linejoin="round"/>`
    + `<path d="${BRAND_MARK_EDGES}" fill="none" stroke="${ground}" stroke-width="${BRAND_MARK_EDGE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `${nodes}</svg>`;
}
