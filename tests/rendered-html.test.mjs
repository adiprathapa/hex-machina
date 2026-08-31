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

test("ships Hex Machina instead of the starter preview", async () => {
  const [page, layout, client, packageJson, css, policy] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HexMachina.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../src/eval/policy-benchmark.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<HexMachina \/>/);
  assert.match(layout, /Hex Machina \| Cooperative Spell Debugging/);
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
  assert.match(client, /Water the moonflower/);
  assert.match(client, /The ducks are funny\. They stay\./);
  assert.match(client, /Drag runes to rearrange/);
  assert.match(client, /dragOffsetRef/);
  assert.match(client, /Graph edge legend/);
  assert.match(client, /marker id="arrow-default"/);
  assert.match(client, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/);
  assert.match(client, /Same handlers · structured JSON/);
  assert.match(client, /Agent Gym · evaluation mode/);
  assert.match(client, /Scored, replayable episode/);
  assert.match(client, /before\/after graph observations/);
  assert.match(client, /Held-out policy/);
  assert.match(client, /AGENT_GYM_POLICY_BASELINES/);
  assert.match(policy, /Mutate first/);
  assert.match(policy, /Memorized IDs/);
  assert.match(client, /instrumentSpellToolHandlers/);
  assert.match(client, /Export episode JSON/);
  assert.match(client, /96 variants · 3 causal families · vector \+ offline rollouts/i);
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
  const mobileStart = css.indexOf("@media (max-width: 760px)");
  const reducedMotionStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.notEqual(mobileStart, -1);
  assert.equal(reducedMotionStart > mobileStart, true);
  const mobileCss = css.slice(mobileStart, reducedMotionStart);
  assert.match(mobileCss, /\.mission-chip\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*center;/);
  assert.doesNotMatch(mobileCss, /\.canvas-panel\s*\{\s*order:\s*-1/);
  assert.match(mobileCss, /\.tool-console-grid button,[\s\S]*?\.connection-editor select\s*\{\s*min-height:\s*44px;/);
  assert.equal(templateRoot.pathname.endsWith("/"), true);
});
