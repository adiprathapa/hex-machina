import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("ships Hexmend instead of the starter preview", async () => {
  const [page, layout, client, packageJson, css, policy, scenario] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/Hexmend.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../src/eval/policy-benchmark.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/scenarios/moonflower.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Hexmend \/>/);
  assert.match(layout, /Hexmend \| Agent Gym for Constraint-Aware Repair/);
  // Two faces, two roles: a neutral grotesk for anything a person reads, a
  // monospace for machine data where character alignment carries meaning.
  assert.match(layout, /Inter/);
  assert.match(layout, /Fira_Code/);
  assert.match(layout, /--font-inter/);
  assert.match(layout, /--font-fira-code/);
  assert.match(css, /var\(--font-inter\)/);
  assert.match(css, /var\(--font-fira-code\)/);
  assert.doesNotMatch(`${layout}\n${css}`, /Poppins|font-poppins/);
  assert.doesNotMatch(`${layout}\n${css}`, /font-geist/);
  // The objective and the human constraint are rendered from the loaded task
  // rather than written into the markup, so a held-out variant describes itself
  // instead of narrating the canonical lesson.
  assert.match(client, /\{graph\.desiredOutcome\}/);
  assert.match(client, /constraintText/);
  assert.match(client, /graph\.semantics\.effectId/);
  assert.match(client, /graph\.semantics\.roles\.subject/);
  assert.doesNotMatch(client, /"summon-ducks"|"flooded-observatory"/);
  assert.match(scenario, /Water the moonflower/);
  assert.match(client, /The ducks are funny\. They stay\./);
  assert.match(client, /Drag runes to rearrange/);
  assert.match(client, /dragOffsetRef/);
  assert.match(client, /Graph edge legend/);
  assert.match(client, /marker id="arrow-default"/);
  assert.match(client, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/);
  assert.match(client, /Same handlers, structured JSON/);
  assert.match(client, /Agent Gym evaluation mode/);
  assert.match(client, /Scored, replayable episode/);
  assert.match(client, /before\/after graph observations/);
  assert.match(client, /Held-out policy/);
  assert.match(client, /AGENT_GYM_POLICY_BASELINES/);
  assert.match(policy, /Mutate first/);
  assert.match(policy, /Memorized IDs/);
  assert.match(client, /instrumentSpellToolHandlers/);
  assert.match(client, /Export episode JSON/);
  assert.match(client, /96 variants across 3 causal families, with vector and offline rollouts/i);
  assert.match(client, /aria-label="Semantic tool console"/);
  assert.match(client, /handlers\.inspect_spell/);
  assert.match(client, /handlers\.apply_spell_patch/);
  assert.match(client, /patch\?\.operationLedger/);
  assert.doesNotMatch(client, /buildPatchPreview/);
  assert.match(client, /Experimental Familiar graph prediction/);
  assert.match(client, /inferFamiliar\(graph, cast\)/);
  assert.match(client, /Link from rune/);
  assert.match(client, /aria-label="Typed edge category"/);
  assert.match(client, /getValidEdgeTypes/);
  assert.match(client, /connectRunes/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(layout, /—/);
  assert.match(layout, /Inter/);
  assert.match(layout, /Fira_Code/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /button:focus-visible/);
  const cssColor = (name) => css.match(new RegExp(`--${name}:\\s*(#[a-f\\d]{6})`, "i"))?.[1];
  const raisedPanel = cssColor("panel-raised");
  assert.ok(contrastRatio(cssColor("ink"), raisedPanel) >= 4.5);
  assert.ok(contrastRatio(cssColor("muted"), raisedPanel) >= 4.5);
  assert.ok(contrastRatio(cssColor("subtle"), raisedPanel) >= 4.5);
  assert.ok(contrastRatio("#12150b", cssColor("acid")) >= 4.5);
  // These lighter semantic tokens are the text counterparts to the darker
  // border/fill colours. Keep their WCAG AA floor executable: a future visual
  // pass must not quietly put the mid-tone intent colours back on dark panels.
  assert.ok(contrastRatio(cssColor("ember-text"), raisedPanel) >= 4.5);
  assert.ok(contrastRatio(cssColor("aqua-text"), raisedPanel) >= 4.5);
  assert.ok(contrastRatio(cssColor("blue-text"), raisedPanel) >= 4.5);
  // The palette is a single hue, so success and failure cannot be told apart by
  // colour alone (WCAG 1.4.1). Failure is an outline on a dark wash; success
  // reverses out of a solid fill at the brightest step. Both also carry their
  // own word, "Cast failed" and "Verified". Pin the two-channel difference, not
  // just the token names — the previous assertion matched `border-color` and
  // would have passed on a design that dropped the distinction entirely.
  const visionFailure = css.match(/\.vision-symbol\s*\{([^}]*)\}/)?.[1] ?? "";
  const visionSuccess = css.match(/\.vision-success \.vision-symbol\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(visionFailure, /background:\s*var\(--failure-wash\)/);
  assert.match(visionFailure, /\bcolor:\s*var\(--ember-text\)/);
  assert.match(visionSuccess, /background:\s*var\(--aqua-text\)/);
  assert.match(visionSuccess, /\bcolor:\s*var\(--black\)/);
  assert.ok(
    contrastRatio(cssColor("black"), cssColor("aqua-text")) >= 4.5,
    "the success chip reverses out of its fill legibly",
  );

  // One hue only: no other named colour may enter the palette.
  const paletteHues = [...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)]
    .filter(([, name]) => !/^(black|paper|panel|panel-raised|ink|muted|subtle)$/.test(name))
    .map(([, name, hex]) => {
      const [r, g, b] = hex.match(/[a-f\d]{2}/gi).map((v) => Number.parseInt(v, 16));
      return { name, hex, blueDominant: b >= r && b >= g };
    });
  assert.deepEqual(
    paletteHues.filter((entry) => !entry.blueDominant),
    [],
    "every intent colour is a step on the one blue ramp",
  );
  assert.doesNotMatch(css, /\.controls\s*\{[^}]*position:\s*sticky/);
  const mobileStart = css.indexOf("@media (max-width: 760px)");
  const reducedMotionStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.notEqual(mobileStart, -1);
  assert.equal(reducedMotionStart > mobileStart, true);
  const mobileCss = css.slice(mobileStart, reducedMotionStart);
  assert.match(mobileCss, /\.mission-chip\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*center;/);
  assert.doesNotMatch(mobileCss, /\.canvas-panel\s*\{\s*order:\s*-1/);
  // Compact touch targets come from one token rather than a list of named
  // controls, which kept drifting as controls were added — the task loader, the
  // prompt actions and the source link all measured 32px while the list said 44.
  assert.match(mobileCss, /:root\s*\{\s*--control-min-h:\s*44px;\s*\}/);
  assert.match(mobileCss, /\.hexmend button,[\s\S]*?\.skip-link\s*\{\s*min-height:\s*var\(--control-min-h\);/);
  assert.match(css, /--control-min-h:\s*32px;/);
  // No control may pin itself to a pointer-sized height and escape the compact
  // override. A rule may still ask for something taller, as long as it does so
  // through the token (max(var(--control-min-h), …)) rather than around it.
  const pinnedControlHeights = (css.match(/min-height:\s*[^;]+;/g) ?? [])
    .filter((rule) => /\b(30|32|36|40)px/.test(rule))
    .filter((rule) => !rule.includes("--control-min-h"));
  assert.deepEqual(
    pinnedControlHeights,
    [],
    "controls size themselves from --control-min-h, not a hard-coded pointer height",
  );
  // The panning wrapper must be layout-transparent anywhere but the compact
  // layout. Left as a real box it sits between .canvas-panel's flex column and
  // the canvas, the canvas loses its height, and every absolutely-positioned
  // rune collapses onto a single row.
  assert.match(css, /\.canvas-viewport\s*\{\s*display:\s*contents;\s*\}/);
  // The three-column layout stops working before the phone breakpoint: the
  // canvas drops under 560px from about 940px down, and a 154px rune cannot
  // tile it. Panning starts there, not at 760, or a tablet in portrait stacks
  // runes on top of each other.
  const panStart = css.indexOf("@media (max-width: 940px)");
  assert.notEqual(panStart, -1, "the diagram pans from the width where the canvas gets too narrow");
  const panCss = css.slice(panStart, css.indexOf("@media", panStart + 10));
  assert.match(panCss, /\.canvas-viewport\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(panCss, /\.spell-canvas\s*\{[\s\S]*?min-width:\s*680px;/);

  // touch-action belongs on the things you drag, not on the surface you pan.
  // On the canvas it cancelled the very gesture the panning viewport exists for
  // — half the graph, including the two runes the objective names, was
  // unreachable by finger — and turned a 570px-tall region into a vertical
  // scroll trap in the middle of a 2600px page. Invisible on a desktop, so it
  // has to be pinned here.
  const canvasRule = css.match(/\.spell-canvas\s*\{([^}]*)\}/)?.[1] ?? "";
  const runeRule = css.match(/\.rune\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(
    canvasRule,
    /touch-action:\s*none/,
    "the pannable canvas must not cancel touch panning or page scroll",
  );
  assert.match(canvasRule, /touch-action:\s*pan-x pan-y/);
  assert.match(runeRule, /touch-action:\s*none/, "a drag that starts on a rune must not also scroll");

  // WCAG 1.4.11: where a border is the only thing saying "this is a control",
  // it needs 3:1 against its ground. --line-strong measured 2.36:1, and 29
  // controls sat on it. Structural rules between sections stay quiet on purpose.
  const controlLine = css.match(/--line-control:\s*rgba\(255, 255, 255, \.(\d+)\)/)?.[1];
  assert.ok(controlLine, "a dedicated control-boundary token exists");
  assert.ok(
    Number(`0.${controlLine}`) >= 0.34,
    `the control boundary must clear 3:1 on --panel-raised (alpha 0.${controlLine})`,
  );

  assert.equal(templateRoot.pathname.endsWith("/"), true);
});
