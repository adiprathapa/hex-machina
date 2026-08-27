import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);
test("ships Hex Machina instead of the starter preview", async () => {
  const [page, layout, client, packageJson, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HexMachina.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<HexMachina \/>/);
  assert.match(layout, /Hex Machina — Cooperative Spell Debugging/);
  assert.match(client, /Water the moonflower/);
  assert.match(client, /The ducks are funny\. They stay\./);
  assert.match(client, /Drag runes to rearrange/);
  assert.match(client, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/);
  assert.match(client, /Same handlers · structured JSON/);
  assert.match(client, /aria-label="Semantic tool console"/);
  assert.match(client, /handlers\.inspect_spell/);
  assert.match(client, /handlers\.apply_spell_patch/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /button:focus-visible/);
  assert.equal(templateRoot.pathname.endsWith("/"), true);
});
