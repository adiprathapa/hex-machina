/**
 * Records the demo as a real screencast driven entirely through the registered
 * WebMCP tools.
 *
 * The previous demo was three static screenshots concatenated under narration.
 * It never showed an agent calling a tool, which is the entire claim, and the
 * challenge rules let judges score a submission from the video alone. Here a
 * standing-in WebMCP host installs `document.modelContext`, and every action is
 * a tool call: no clicks drive the repair. Beats are paced to the narration so
 * a viewer hears the claim while watching it happen.
 *
 * Usage: node submission/video/record-screencast.mjs [url]
 */
import path from "node:path";
import { chromium } from "playwright-core";

const URL_BASE = process.argv[2] ?? "http://localhost:4321/";
const OUT = path.resolve(process.env.DEMO_VIDEO_DIR ?? ".demo-video");

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();

// A real WebMCP host, so the recording shows tools firing rather than clicks.
await page.addInitScript(() => {
  const tools = new Map();
  window.__tools = tools;
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool(d, o = {}) {
        tools.set(d.name, d);
        o.signal?.addEventListener("abort", () => tools.delete(d.name), { once: true });
        return Promise.resolve();
      },
    },
  });
});

const call = (n, i = {}) => page.evaluate(
  async ({ n, i }) => window.__tools.get(n).execute(i, { signal: new AbortController().signal }),
  { n, i },
);
const beat = (ms) => page.waitForTimeout(ms);

await page.goto(URL_BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__tools?.size === 7, { timeout: 20000 });
await beat(11000);                                   // the board, and WebMCP going live

await call("inspect_spell"); await beat(6000);      // agent grounds itself
const failure = await call("simulate_cast");        // the flood
const effectId = failure.sideEffects[0].id;
await beat(11000);

await call("trace_effect", { effectId }); await beat(11000);
await call("explain_side_effect", { sideEffectId: effectId }); await beat(11500);

// The human's constraint is the turn of the story.
await call("set_sacred_constraint", {
  targetId: await page.evaluate(() => window.__subject ?? "summon-ducks"),
  reason: "The ducks are funny. They stay.",
});
await beat(12000);

const proposal = await call("propose_spell_patch");
const patchId = proposal.patches[0].id;
await beat(13500);                                    // the ledger, before anything is applied

await call("simulate_cast", { patchId }); await beat(6000);
await call("apply_spell_patch", { patchId }); await beat(6500);
await call("simulate_cast"); await beat(14000);       // ducks alive, room dry

// Then prove it is not on rails.
await page.evaluate(() => { const r = document.querySelector(".familiar-panel"); if (r) r.scrollTo({ top: r.scrollHeight, behavior: "smooth" }); });
await beat(7000);
await page.locator(".scenario-lab summary").click({ force: true });
await beat(2000);
await page.evaluate(() => { const r = document.querySelector(".familiar-panel"); if (r) r.scrollTo({ top: r.scrollHeight, behavior: "smooth" }); });
await beat(3000);
await page.getByLabel("Rule").selectOption({ index: 2 }, { force: true });
await page.getByLabel("Split").selectOption("test", { force: true });
await beat(3500);
await page.getByRole("button", { name: "Load task", exact: true }).click({ force: true });
await beat(9000);

const f2 = await call("simulate_cast");
await beat(7000);
const fx2 = f2.sideEffects[0].id;
await call("trace_effect", { effectId: fx2 }); await beat(6500);
await call("explain_side_effect", { sideEffectId: fx2 }); await beat(7000);
await beat(6000);

await context.close();
await browser.close();
console.log("recorded");
