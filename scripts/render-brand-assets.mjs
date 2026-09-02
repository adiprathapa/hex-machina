// Regenerates public/og.png and public/favicon.png from the same hexagon mark
// and palette the interface ships. Hand-made assets drifted from the UI once
// already; keeping them in a script means they cannot drift silently again.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { brandMarkSvg } from "../src/brand/mark.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BLACK = "#0c0c0d";
const INK = "#ededef";
const MUTED = "#a1a1aa";
const BLUE = "#4c90f0";

// One definition for the header, the tab icon and this card. Run through tsx
// (`npm run brand:render`) so the TypeScript module resolves.
const MARK = (size) => brandMarkSvg(size, BLUE);

const FONT = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

const OG = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: ${BLACK}; color: ${INK};
         font-family: ${FONT}; display: flex; flex-direction: column;
         justify-content: space-between; padding: 76px 84px; }
  .grid { position: fixed; inset: 0; pointer-events: none;
          background-image: linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
          background-size: 48px 48px; }
  .top { display: flex; align-items: center; gap: 20px; position: relative; }
  .name { font-size: 30px; font-weight: 600; letter-spacing: -.01em; }
  h1 { font-size: 59px; line-height: 1.14; font-weight: 600; letter-spacing: -.028em;
       max-width: 1040px; position: relative; white-space: nowrap; }
  h1 em { font-style: normal; color: ${BLUE}; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end;
          border-top: 1px solid rgba(255,255,255,.13); padding-top: 26px;
          font-size: 20px; color: ${MUTED}; position: relative; gap: 40px; }
  .foot b { color: ${INK}; font-weight: 500; }
  .pills { display: flex; gap: 10px; flex: none; }
  .pill { border: 1px solid rgba(255,255,255,.16); border-radius: 2px;
          padding: 7px 13px; font-size: 17px; color: ${MUTED}; white-space: nowrap; }
</style>
<div class="grid"></div>
<div class="top">${MARK(52)}<span class="name">Hex Machina</span></div>
<h1>Humans decide what matters.<br>Agents prove the <em>smallest repair</em>.</h1>
<div class="foot">
  <div><b>An agent gym on one executable graph.</b><br>Seven WebMCP tools · 96 deterministic tasks</div>
  <div class="pills"><span class="pill">WebMCP</span><span class="pill">Deterministic</span><span class="pill">Open source</span></div>
</div>`;

// The tab icon is the mark alone on a transparent ground, so it sits cleanly
// on a light tab strip and a dark one alike.
const ICON = `<!doctype html><meta charset="utf-8">
<style>* { margin: 0; } body { width: 256px; height: 256px; background: transparent;
  display: flex; align-items: center; justify-content: center; }</style>
${MARK(208)}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

async function shoot(html, width, height, out, { transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, await page.screenshot({ type: "png", omitBackground: transparent }));
  await page.close();
  console.log(`wrote ${path.relative(ROOT, out)} (${width}x${height})`);
}

await shoot(OG, 1200, 630, path.join(ROOT, "public/og.png"));
await shoot(ICON, 256, 256, path.join(ROOT, "public/favicon.png"), { transparent: true });
await browser.close();
