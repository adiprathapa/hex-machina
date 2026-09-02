/**
 * Records the demo as a real screencast driven entirely through the registered
 * WebMCP tools.
 *
 * The previous demo was three static screenshots concatenated under narration.
 * It never showed an agent calling a tool, which is the entire claim, and the
 * challenge rules let judges score a submission from the video alone. Here a
 * standing-in WebMCP host installs `document.modelContext`, and every action is
 * a tool call: no clicks drive the repair. Actions are scheduled against the
 * recorded narration's paragraph timeline, so a viewer hears the claim while
 * watching it happen.
 *
 * Usage: DEMO_TIMELINE=submission/video/narration-timeline.json node submission/video/record-screencast.mjs [url]
 */
import { readFile } from "node:fs/promises";
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

// The narration is a recording, so its paragraphs land where the reader put
// them. The timeline lists each paragraph's start and end in audio seconds;
// every action below is scheduled against the paragraph that narrates it, so
// "Now it traces the effect" is heard while the trace lands. Video time = the
// lead-in plus audio time; the clock starts when recording does.
const timeline = JSON.parse(await readFile(process.env.DEMO_TIMELINE, "utf8"));
const leadIn = timeline.leadInSeconds;
const P = timeline.paragraphs;
const at = (k, fraction = 0) => leadIn + P[k - 1].start + (P[k - 1].end - P[k - 1].start) * fraction;
const clock0 = Date.now();
const until = async (seconds) => {
  const ms = clock0 + seconds * 1000 - Date.now();
  if (ms > 0) await page.waitForTimeout(ms);
};

await page.goto(URL_BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__tools?.size === 7, { timeout: 20000 });

// Paragraphs 1 and 2: the board, and WebMCP going live.
await until(at(3));                                   // "First it inspects the live graph"
await call("inspect_spell");
await until(at(3, 0.3));                              // "then it casts the spell"
const failure = await call("simulate_cast");          // the flood
const effectId = failure.sideEffects[0].id;

await until(at(4));                                   // "Now it traces the effect"
await call("trace_effect", { effectId });
await until(at(5));                                   // "Then it proves the diagnosis"
await call("explain_side_effect", { sideEffectId: effectId });

// The human's constraint is the turn of the story.
await until(at(6, 0.55));                             // "That becomes an executable constraint"
await call("set_sacred_constraint", {
  targetId: await page.evaluate(() => window.__subject ?? "summon-ducks"),
  reason: "The ducks are funny. They stay.",
});

await until(at(7));                                   // "Watch what it changes"
const proposal = await call("propose_spell_patch");
const patchId = proposal.patches[0].id;
// Paragraph 8: the ledger, before anything is applied.

await until(at(9));                                   // "The patch is simulated first"
await call("simulate_cast", { patchId });
await until(at(9, 0.5));                              // "Then applied atomically"
await call("apply_spell_patch", { patchId });
await until(at(10));                                  // "The recast succeeds"
await call("simulate_cast");                          // ducks alive, room dry

// Then prove it is not on rails.
await until(at(11));                                  // "One more thing"
await page.evaluate(() => { const r = document.querySelector(".familiar-panel"); if (r) r.scrollTo({ top: r.scrollHeight, behavior: "smooth" }); });
await until(at(12));                                  // "The evaluation layer generates 96 tasks"
await page.locator(".scenario-lab summary").click({ force: true });
await until(at(12, 0.25));
await page.evaluate(() => { const r = document.querySelector(".familiar-panel"); if (r) r.scrollTo({ top: r.scrollHeight, behavior: "smooth" }); });
await page.getByLabel("Rule").selectOption({ index: 2 }, { force: true });
await page.getByLabel("Split").selectOption("test", { force: true });
await until(at(12, 0.6));                             // "I will use the interface to load a held-out one"
await page.getByRole("button", { name: "Load task", exact: true }).click({ force: true });

await until(at(13));                                  // "Every rune, edge and effect identifier is freshly remapped"
const f2 = await call("simulate_cast");
const fx2 = f2.sideEffects[0].id;
await until(at(13, 0.55));                            // "The same seven tools inspect it, cast it, trace it"
await call("trace_effect", { effectId: fx2 });
await until(at(13, 0.8));                             // "and explain it"
await call("explain_side_effect", { sideEffectId: fx2 });

await until(leadIn + timeline.audioSeconds + 4);      // "That is the claim", then hold
await beat(500);

await context.close();
await browser.close();
