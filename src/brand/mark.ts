/**
 * The one brand mark, shared by the interface header, the favicon and the
 * social card so they cannot drift apart: a plain solid hexagon. Solid rather
 * than outlined because an outline vanishes at the 16px a browser tab gives
 * it, and plain because the causal path that used to sit inside it read as
 * clutter at every size that mattered.
 *
 * Coordinates are in a 32-unit box; the stroke rounds the corners.
 */
export const BRAND_MARK_VIEWBOX = "0 0 32 32";
export const BRAND_MARK_HEX = "M16 2.6 27.2 9v14L16 29.4 4.8 23V9z";
export const BRAND_MARK_CORNER = 2;

/** Standalone SVG markup for the asset renderer. */
export function brandMarkSvg(size: number, ink: string) {
  return `<svg viewBox="${BRAND_MARK_VIEWBOX}" width="${size}" height="${size}">`
    + `<path d="${BRAND_MARK_HEX}" fill="${ink}" stroke="${ink}" stroke-width="${BRAND_MARK_CORNER}" stroke-linejoin="round"/>`
    + `</svg>`;
}
