import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_TIMEOUT_MS = 20_000;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional system-browser location.
    }
  }

  throw new Error(
    "A system Chrome/Chromium executable is required. Set CHROME_PATH when it is installed in a non-standard location.",
  );
}

async function startProductionServer(port) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(
    command,
    ["run", "start", "--", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: ROOT,
      detached: process.platform !== "win32",
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited with ${child.exitCode}.\n${output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return { child, url, output: () => output };
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  stopProcess(child);
  throw new Error(`Production server did not become ready.\n${output}`);
}

function stopProcess(child) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function assertVisible(locator, message) {
  await locator.waitFor({ state: "visible", timeout: 5_000 });
  assert.equal(await locator.isVisible(), true, message);
}

test("production browser completes the constraint-preserving spell journey", { timeout: 60_000 }, async () => {
  const port = await availablePort();
  const server = await startProductionServer(port);
  let browser;

  try {
    browser = await chromium.launch({
      executablePath: await chromeExecutable(),
      headless: true,
      args: process.platform === "linux" ? ["--no-sandbox"] : [],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const browserErrors = [];
    const externalRequests = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== new URL(server.url).origin) {
        externalRequests.push(request.url());
      }
    });
    await page.addInitScript(() => {
      const tools = new Map();
      Object.defineProperty(window, "__hexWebMCPTools", { value: tools, configurable: true });
      Object.defineProperty(document, "modelContext", {
        configurable: true,
        value: {
          registerTool(definition, options = {}) {
            if (tools.has(definition.name)) {
              return Promise.reject(new DOMException(`Duplicate tool: ${definition.name}`, "InvalidStateError"));
            }
            tools.set(definition.name, definition);
            options.signal?.addEventListener("abort", () => tools.delete(definition.name), { once: true });
            return Promise.resolve();
          },
        },
      });
    });

    await page.goto(server.url, { waitUntil: "networkidle" });
    await assertVisible(page.getByRole("region", { name: "Agent Gym evaluation" }), "the scored agent environment is visible");
    assert.match(await page.locator(".agent-gym").innerText(), /0\s*\/\s*23[\s\S]*0 steps/i);
    assert.equal(await page.getByRole("button", { name: "Export episode JSON" }).isDisabled(), true);
    const judgeEntry = await page.evaluate(() => {
      const panel = document.querySelector(".brief-panel");
      const brief = document.querySelector(".agent-brief");
      const actions = [...document.querySelectorAll(".agent-brief-actions .quiet")];
      const controls = document.querySelector(".controls");
      if (!panel || !brief || actions.length !== 2 || !controls) return null;

      const panelRect = panel.getBoundingClientRect();
      const briefRect = brief.getBoundingClientRect();
      const visibleTop = Math.max(panelRect.top, briefRect.top, 0);
      const visibleBottom = Math.min(panelRect.bottom, briefRect.bottom, innerHeight);
      const visibleRatio = Math.max(0, visibleBottom - visibleTop) / briefRect.height;
      const actionTargets = actions.map((action) => {
        const rect = action.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          bottom: rect.bottom,
          top: rect.top,
          hittable: hit === action || action.contains(hit),
        };
      });

      const primary = document.querySelector(".controls .primary");
      const primaryRect = primary?.getBoundingClientRect();
      const panelRectForPrimary = panel.getBoundingClientRect();
      const primaryHit = primaryRect
        ? document.elementFromPoint(
            primaryRect.left + primaryRect.width / 2,
            primaryRect.top + primaryRect.height / 2,
          )
        : null;

      return {
        primaryAction: primaryRect
          ? {
              top: Math.round(primaryRect.top),
              railBottom: Math.round(panelRectForPrimary.bottom),
              visibleWithoutScrolling:
                primaryRect.top >= panelRectForPrimary.top
                && primaryRect.bottom <= panelRectForPrimary.bottom
                && primaryRect.bottom <= innerHeight,
              hittable: primaryHit ? primary.contains(primaryHit) || primaryHit === primary : false,
            }
          : null,
        panelScrollTop: panel.scrollTop,
        visibleRatio,
        actionTargets,
        controlsPosition: getComputedStyle(controls).position,
        wish: (() => {
          const rect = document.querySelector(".wish")?.getBoundingClientRect();
          return rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom) } : null;
        })(),
        stepsTop: document.querySelector(".quest-steps")?.getBoundingClientRect().top ?? Infinity,
      };
    });
    assert.ok(judgeEntry, "the browser-agent brief and human controls render");
    // The primary action sat under about a thousand pixels of prose, so on every
    // common laptop viewport a judge landed on the page unable to see the one
    // button they are meant to press. Measured, not assumed.
    assert.ok(
      judgeEntry.primaryAction,
      "the primary call to action is rendered",
    );
    assert.equal(
      judgeEntry.primaryAction.visibleWithoutScrolling,
      true,
      `the primary action is visible without scrolling (top ${judgeEntry.primaryAction.top}, rail ends ${judgeEntry.primaryAction.railBottom})`,
    );
    assert.equal(judgeEntry.primaryAction.hittable, true, "the primary action is not covered by anything");
    assert.equal(judgeEntry.panelScrollTop, 0, "judge access does not depend on a pre-scrolled sidebar");
    assert.ok(judgeEntry.visibleRatio >= 0.9, `at least 90% of the agent brief is initially visible (got ${judgeEntry.visibleRatio})`);
    assert.equal(judgeEntry.actionTargets.every(({ top, bottom }) => top >= 0 && bottom <= 720), true, "both judge actions are inside the initial viewport");
    assert.equal(judgeEntry.actionTargets.every(({ hittable }) => hittable), true, "both judge actions are unobscured and clickable");
    assert.notEqual(judgeEntry.controlsPosition, "sticky", "human controls cannot cover the browser-agent brief");
    // The human intent is the constraint the whole demo turns on. It sat 276px
    // below the rail at 1280x720 (918-974 in a 698px rail), invisible without
    // scrolling in five of six viewport/state pairs. Now it follows the title
    // (measured 167-218) and the steps begin inside the first screen (~508).
    assert.ok(
      judgeEntry.wish
        && judgeEntry.wish.top >= 0
        && judgeEntry.wish.bottom <= Math.min(720, judgeEntry.primaryAction.railBottom),
      `the human intent is visible without scrolling (wish ${JSON.stringify(judgeEntry.wish)}, rail ends ${judgeEntry.primaryAction.railBottom})`,
    );
    assert.ok(judgeEntry.stepsTop < 720, `the quest steps begin inside the initial viewport (top ${judgeEntry.stepsTop})`);
    // Two type roles, and they must stay separated: the interface face for
    // anything a person reads, the code face only for literal code — tool
    // identifiers, the pasted prompt's `document.modelContext`, task ids and
    // the console's JSON. Setting every label in monospace made the whole
    // interface read as a terminal; the reverse drift had thirteen labels (the
    // policy table, the ledger, the console summaries) in the code face while
    // their neighbours were not, so the table row measured here moved to the
    // interface face with tabular figures and the tool identifier took its
    // place as the code sample.
    const computedFonts = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      semanticLabel: getComputedStyle(document.querySelector(".section-kicker")).fontFamily,
      tableLabel: getComputedStyle(document.querySelector(".policy-baseline span")).fontFamily,
      machineData: getComputedStyle(document.querySelector(".tool-console-grid button code")).fontFamily,
    }));
    assert.match(computedFonts.body, /Inter/i, "the production body uses the intended interface typeface");
    assert.match(computedFonts.semanticLabel, /Inter/i, "interface labels use the interface typeface");
    assert.match(computedFonts.tableLabel, /Inter/i, "table labels use the interface typeface too");
    assert.match(computedFonts.machineData, /Fira Code/i, "tool identifiers keep the code typeface");
    // The right rail is three zones: the narrative (which scrolls), the tool
    // feed, and the two pinned consoles. Before the rail was compacted the
    // Agent Gym card alone was 450-500px, so at 1280x720 the rail overflowed by
    // 873px in the repair state and at 1920x1080 the pinned consoles were
    // squeezed to 2px. Measured in the repair and repaired states, where the
    // narrative zone is at its longest and shortest.
    const measureRail = () => page.evaluate(() => {
      const panel = document.querySelector(".familiar-panel");
      const list = document.querySelector(".activity-list");
      const feed = list.getBoundingClientRect();
      return {
        panelOverflow: panel.scrollHeight - panel.clientHeight,
        details: [...panel.querySelectorAll("details.tool-console")].map((d) => d.getBoundingClientRect().height),
        feedHeight: feed.height,
        feedTop: feed.top,
        rows: list.querySelectorAll("article").length,
        innerHeight,
      };
    });
    const assertRailGuard = (rail, label) => {
      assert.equal(rail.panelOverflow, 0, `${label}: the right rail itself never scrolls (overflow ${rail.panelOverflow}px)`);
      assert.equal(rail.details.length, 2, `${label}: the Task loader and the Local tool console are both pinned`);
      assert.ok(rail.details.every((height) => height >= 44), `${label}: both pinned consoles keep a reachable summary (${rail.details.map(Math.round).join(", ")}px)`);
      assert.ok(rail.feedHeight >= 140, `${label}: the tool feed keeps at least 140px (got ${Math.round(rail.feedHeight)}px)`);
      assert.ok(rail.feedTop + rail.feedHeight <= rail.innerHeight, `${label}: the tool feed ends inside the window (bottom ${Math.round(rail.feedTop + rail.feedHeight)} of ${rail.innerHeight})`);
      assert.ok(rail.rows >= 7, `${label}: the feed lists every registered tool (${rail.rows} rows)`);
    };
    await page.getByRole("button", { name: /Cast spell/ }).click();
    await assertVisible(page.getByText("Twelve ducks. One indoor lake.", { exact: true }), "failure spectacle is visible");
    await assertVisible(page.getByText("Side effect detected", { exact: true }), "failure state is visible");

    await page.getByRole("button", { name: "Trace the glitch", exact: true }).click();
    await assertVisible(page.getByRole("button", { name: "Protect the ducks", exact: true }), "constraint action is available");
    await page.getByRole("button", { name: "Protect the ducks", exact: true }).click();
    await assertVisible(page.locator(".rune.sacred"), "the duck rune visibly carries its sacred constraint");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v2/);

    await page.getByRole("button", { name: "Find a repair", exact: true }).click();
    await assertVisible(page.getByRole("heading", { name: "Give the ducks umbrellas", exact: true }), "constraint-aware patch is previewed");
    assert.match(await page.locator(".patch-card").innerText(), /RANK\s+#1[\s\S]*EDITS\s+8[\s\S]*ELIGIBLE\s+1\/2/i);
    const patchLedger = page.locator(".patch-ledger");
    await assertVisible(patchLedger, "the human can inspect every proposed structural mutation before approval");
    assert.equal(await patchLedger.locator("li").count(), 8, "the ledger accounts for all eight graph edits");
    assert.match(await patchLedger.innerText(), /Disconnect Summon ducks → Pour \(flows to\)/);
    assert.match(await patchLedger.innerText(), /Connect Pour → Moonflower \(targets\)/);
    assert.match(await patchLedger.innerText(), /Awaken Umbrella/);
    const patchPreflight = page.locator(".patch-preflight");
    await assertVisible(patchPreflight, "the approval card exposes exact structural preconditions");
    assert.match(await patchPreflight.innerText(), /Preflight for graph v2[\s\S]*2 live edges, 2 dormant runes, 1 sacred lock/i);
    assert.equal(await page.locator(".edge-layer line.patch-remove").count(), 2, "removed connections are previewed on the graph");
    assert.equal(await page.locator(".edge-layer line.patch-add").count(), 4, "new connections are previewed on the graph");
    assert.equal(await page.locator(".rune.patch-activate").count(), 2, "dormant runes to awaken are previewed on the graph");
    assertRailGuard(await measureRail(), "1280x720 with the patch card");
    await page.getByRole("button", { name: "Simulate patch safely", exact: true }).click();
    await assertVisible(page.getByText("Unapplied simulation", { exact: true }), "a human can safely test the repair before approval");
    await assertVisible(page.locator(".preview-verdict"), "the unapplied prediction is visibly distinguished from editor state");
    assert.match(await page.locator(".preview-verdict").innerText(), /Predicted\s+Stable[\s\S]*Editor remains at graph v2/i);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v2/, "preview simulation does not advance the graph");
    await page.getByRole("button", { name: "Apply patch & recast", exact: true }).click();
    await assertVisible(page.getByText("Stable", { exact: true }), "successful cast is stable");
    await assertVisible(page.getByText("The moonflower blooms", { exact: true }), "successful outcome is visible");
    assert.match(await page.locator(".cast-vision").innerText(), /twelve umbrella-equipped ducks/i);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v3/);
    assert.equal(await page.locator(".rune.sacred").count(), 1, "the repaired spell preserves one sacred rune");
    await assertVisible(page.locator(".agent-gym-heading .complete"), "apply and recast completes the visible evaluation episode");
    assert.match(await page.locator(".agent-gym").innerText(), /complete[\s\S]*23\s*\/\s*23/i);
    assertRailGuard(await measureRail(), "1280x720 after the repair");
    const [episodeDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export episode JSON" }).click(),
    ]);
    assert.equal(episodeDownload.suggestedFilename(), "hex-machina-agent-gym-episode.json");
    const episodePath = await episodeDownload.path();
    assert.ok(episodePath, "the browser produced a local episode artifact");
    const exportedEpisode = JSON.parse(await readFile(episodePath, "utf8"));
    assert.equal(exportedEpisode.status, "complete");
    assert.equal(exportedEpisode.terminationReason, "goal-verified");
    assert.equal(exportedEpisode.trajectory.length, 9);
    assert.equal(exportedEpisode.trajectory.every((transition) => (
      transition.observationBefore &&
      transition.observationAfter &&
      /^fnv1a64:[a-f0-9]{16}$/.test(transition.stateKeyBefore) &&
      /^fnv1a64:[a-f0-9]{16}$/.test(transition.stateKeyAfter)
    )), true, "the visible export contains replay-complete transitions");

    await page.getByRole("button", { name: "Undo agent patch", exact: true }).click();
    await assertVisible(page.getByText("Side effect detected", { exact: true }), "undo restores the failed spell");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v4/);
    assert.equal(await page.locator(".rune.sacred").count(), 1, "undo preserves the human's sacred constraint");

    await page.getByRole("button", { name: "Reset lesson", exact: true }).click();
    await assertVisible(page.getByText("Ready to cast", { exact: true }), "reset returns to the initial state");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v1/);

    await page.locator(".scenario-lab > summary").click();
    // The longest wish first. The rail section that holds the prompt could
    // shrink past the control at its foot: with a three-line wish at 1280x720
    // it was 168px holding 200px of content, and "Show the full prompt" was
    // drawn over step 01 (551-566 against a step box from 534) where a click
    // reached the step instead. The section's floor is now its content with a
    // one-line prompt (toggle 528-543, steps from 551) and the rest scrolls the
    // rail, measured at 17px here.
    await page.getByRole("combobox", { name: "Rule" }).selectOption("family-03-v1");
    await page.getByRole("button", { name: "Load task", exact: true }).click();
    await assertVisible(page.getByText("task-03-test-00", { exact: true }), "the longest-wish held-out task is loaded");
    // Open, the loader is pinned at 276px of a 620px rail here and left the
    // narrative zone 12px with a task loaded, so the read that carries the
    // lesson was gone. Once the task is in the workspace the loader folds
    // shut, its summary names what loaded (the assertion above finds it
    // there), the zone rests on the read whole, and focus lands on the
    // summary rather than <body> when the Load task button hides.
    const folded = await page.evaluate(() => {
      const zone = document.querySelector(".familiar-scroll").getBoundingClientRect();
      const read = document.querySelector(".familiar-message").getBoundingClientRect();
      return {
        open: document.querySelector(".scenario-lab").open,
        zoneHeight: zone.height,
        readWhole: read.top >= zone.top && read.bottom <= zone.bottom,
        focus: document.activeElement?.tagName,
      };
    });
    assert.equal(folded.open, false, "the Task loader folds shut once its task is loaded");
    assert.ok(folded.zoneHeight >= 240, `the narrative zone keeps its height with a task loaded (got ${Math.round(folded.zoneHeight)}px)`);
    assert.equal(folded.readWhole, true, "the current read is whole in the narrative zone after a load");
    assert.equal(folded.focus, "SUMMARY", `focus rests on the loader's summary after a load (got ${folded.focus})`);
    const promptFoot = await page.evaluate(() => {
      const toggle = document.querySelector(".prompt-toggle");
      const box = toggle.getBoundingClientRect();
      const rail = document.querySelector(".brief-panel");
      return {
        toggleBottom: box.bottom,
        stepsTop: document.querySelector(".quest-steps").getBoundingClientRect().top,
        hitsToggle: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === toggle,
        railOverflow: rail.scrollHeight - rail.clientHeight,
      };
    });
    assert.ok(promptFoot.toggleBottom <= promptFoot.stepsTop, `the prompt control ends above the quest steps (toggle ${promptFoot.toggleBottom}, steps ${promptFoot.stepsTop})`);
    assert.equal(promptFoot.hitsToggle, true, "the prompt control is what a click on it reaches");
    assert.ok(promptFoot.railOverflow <= 20, `the rail scrolls by no more than the wish's extra line past its floor (${promptFoot.railOverflow}px)`);
    await page.locator(".scenario-lab > summary").click();
    await page.getByRole("combobox", { name: "Rule" }).selectOption("family-02-v1");
    await page.getByRole("button", { name: "Load task", exact: true }).click();
    await assertVisible(page.getByText("task-02-test-00", { exact: true }), "the selected held-out task is loaded");
    await assertVisible(page.getByText("7 WebMCP tools registered", { exact: true }), "scenario swap re-registers WebMCP");
    const swapped = await page.evaluate(async () => {
      const tools = window.__hexWebMCPTools;
      const inspect = tools.get("inspect_spell");
      const explain = tools.get("explain_side_effect");
      return {
        names: [...tools.keys()].sort(),
        runeIds: inspect.inputSchema.properties.nodeIds.items.enum,
        effectIds: explain.inputSchema.properties.sideEffectId.enum,
        inspection: await inspect.execute({}, { signal: new AbortController().signal }),
      };
    });
    assert.equal(swapped.names.length, 7, "the old registration is removed rather than duplicated");
    assert.equal(swapped.runeIds.length, 12);
    assert.equal(swapped.runeIds.every((id) => /^r-[a-z0-9]+$/.test(id)), true);
    assert.equal(swapped.effectIds.length, 1);
    assert.match(swapped.effectIds[0], /^fx-[a-z0-9]+$/);
    assert.deepEqual(swapped.inspection.nodes.map((node) => node.id).sort(), [...swapped.runeIds].sort());
    assert.equal(swapped.inspection.graphVersion, 1);
    assert.equal(swapped.inspection.scenarioState.status, "unstable");
    // A loader left open rode through the whole next lesson: the zone stayed
    // 49-65px here, every read was cut, and at "Review the patch" the card
    // showed 58 of 623px with the Apply button outside the zone. A lesson
    // step taken with the loader open now folds it, as a load does.
    await page.locator(".scenario-lab > summary").click();
    assert.equal(await page.evaluate(() => document.querySelector(".scenario-lab").open), true, "the Task loader reopens by hand");
    await page.getByRole("button", { name: /Cast spell/ }).click();
    await assertVisible(page.getByText("Seven thunderbirds. One shattered dome.", { exact: true }), "the loaded family drives its own visible failure");
    // The step's primary is refocused on the frame after it mounts, so the
    // focus check waits for that frame rather than sampling the one before.
    await page.waitForFunction(() => document.activeElement?.matches(".controls .primary"), null, { timeout: 2_000 })
      .catch(() => assert.fail("focus rests on the next primary after a step folds the loader"));
    const stepped = await page.evaluate(() => {
      const zone = document.querySelector(".familiar-scroll").getBoundingClientRect();
      const read = document.querySelector(".familiar-message").getBoundingClientRect();
      return {
        open: document.querySelector(".scenario-lab").open,
        zoneHeight: zone.height,
        readWhole: read.top >= zone.top && read.bottom <= zone.bottom,
      };
    });
    assert.equal(stepped.open, false, "a lesson step folds an open Task loader");
    assert.ok(stepped.zoneHeight >= 240, `the narrative zone keeps its height after a step with the loader open (got ${Math.round(stepped.zoneHeight)}px)`);
    assert.equal(stepped.readWhole, true, "the step's read is whole in the narrative zone");

    // At 2560 wide 81% of the interface rendered at 11-12px because the tokens
    // were fixed px; the floor is now 12.5px at 1080 vmin and 14px at 1440 vmin.
    // The scale resolves to today's values at 720 vmin and below, so the
    // 1280x720 pins above and the phone layout below are unchanged by it.
    const smallestVisibleFontSize = () => page.evaluate(() => {
      const hidden = (element) => {
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (ancestor.hidden || style.display === "none" || style.visibility === "hidden") return true;
        }
        return false;
      };
      const clipped = (rect, element) => {
        for (let ancestor = element; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
          const box = ancestor.getBoundingClientRect();
          if (rect.top >= box.bottom - 1 || rect.bottom <= box.top + 1 || rect.left >= box.right - 1 || rect.right <= box.left + 1) return true;
        }
        return false;
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let min = Number.POSITIVE_INFINITY;
      let characters = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const parent = node.parentElement;
        if (!parent || parent.closest("script, style, noscript") || hidden(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
        if (clipped(rect, parent)) continue;
        min = Math.min(min, Number.parseFloat(getComputedStyle(parent).fontSize));
        characters += node.textContent.trim().length;
      }
      return {
        min,
        characters,
        kicker: getComputedStyle(document.querySelector(".section-kicker")).fontSize,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    const settleLayout = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const typeAt1280 = await smallestVisibleFontSize();
    assert.equal(typeAt1280.kicker, "11px", "the type scale still bottoms out at 11px on a 1280x720 laptop");
    assert.equal(typeAt1280.scrollWidth, typeAt1280.clientWidth, "no horizontal overflow at 1280x720");
    for (const { width, height, floor } of [
      { width: 1920, height: 1080, floor: 12.45 },
      { width: 2560, height: 1440, floor: 13.95 },
    ]) {
      await page.setViewportSize({ width, height });
      await settleLayout();
      const type = await smallestVisibleFontSize();
      assert.ok(type.characters > 500, `the walker saw the interface at ${width}x${height} (${type.characters} characters)`);
      assert.ok(
        type.min >= floor,
        `the smallest visible text at ${width}x${height} is at least ${floor}px (got ${type.min}px)`,
      );
      assert.equal(type.scrollWidth, type.clientWidth, `no horizontal overflow at ${width}x${height}`);
    }

    // A desktop monitor gets the same rail guard: on a tall window both
    // reference tables (the held-out benchmark and the two-hop ranking) render
    // open on first paint, and the pinned consoles must still keep their height.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Cast spell/ }).click();
    await page.getByRole("button", { name: "Trace the glitch", exact: true }).click();
    await page.getByRole("button", { name: "Protect the ducks", exact: true }).click();
    await page.getByRole("button", { name: "Find a repair", exact: true }).click();
    await assertVisible(page.getByRole("heading", { name: "Give the ducks umbrellas", exact: true }), "the patch is previewed at 1920x1080");
    const tallTables = await page.evaluate(() => ({
      baselinesOpen: document.querySelector(".policy-baselines").open,
      rankingOpen: document.querySelector(".familiar-signal").open,
      baselineRows: [...document.querySelectorAll(".policy-baseline")].filter((row) => row.checkVisibility()).length,
      rankingRows: [...document.querySelectorAll(".familiar-signal li")].filter((row) => row.checkVisibility()).length,
    }));
    assert.deepEqual(tallTables, { baselinesOpen: true, rankingOpen: true, baselineRows: 5, rankingRows: 3 }, "on a tall window every benchmark and ranking row is open on first paint");
    assertRailGuard(await measureRail(), "1920x1080 with the patch card");
    await page.getByRole("button", { name: "Apply patch & recast", exact: true }).click();
    await assertVisible(page.getByText("The moonflower blooms", { exact: true }), "the repair succeeds at 1920x1080");
    assertRailGuard(await measureRail(), "1920x1080 after the repair");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await assertVisible(page.locator(".mission-chip"), "the compact objective remains visible");
    const responsiveLayout = await page.evaluate(() => {
      const brief = document.querySelector(".brief-panel")?.getBoundingClientRect();
      const canvas = document.querySelector(".canvas-panel")?.getBoundingClientRect();
      const linkButton = document.querySelector(".start-link")?.getBoundingClientRect();
      // A rune is a third of a phone-width canvas, so a layout that tiles three
      // columns on a desktop stacks them on top of each other here. The diagram
      // keeps a workable width and pans inside its own viewport instead.
      const runes = [...document.querySelectorAll(".rune")].map((el) => el.getBoundingClientRect());
      let overlaps = 0;
      for (let a = 0; a < runes.length; a += 1) {
        for (let b = a + 1; b < runes.length; b += 1) {
          const overlapX = Math.min(runes[a].right, runes[b].right) - Math.max(runes[a].left, runes[b].left);
          const overlapY = Math.min(runes[a].bottom, runes[b].bottom) - Math.max(runes[a].top, runes[b].top);
          if (overlapX > 0 && overlapY > 0) overlaps += 1;
        }
      }
      const viewport = document.querySelector(".canvas-viewport");
      return {
        runeOverlaps: overlaps,
        canvasWidth: document.querySelector(".spell-canvas")?.getBoundingClientRect().width,
        canvasPans: viewport ? getComputedStyle(viewport).overflowX === "auto" : false,
        briefTop: brief?.top,
        canvasTop: canvas?.top,
        linkHeight: linkButton?.height,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    assert.ok(responsiveLayout.briefTop < responsiveLayout.canvasTop, "onboarding precedes the graph on mobile");
    assert.equal(responsiveLayout.horizontalOverflow, false, "mobile layout does not overflow horizontally");
    assert.ok(responsiveLayout.linkHeight >= 44, "compact graph controls retain a 44px touch target");
    assert.equal(responsiveLayout.runeOverlaps, 0, "no two runes overlap on a phone");
    assert.equal(responsiveLayout.canvasPans, true, "the diagram pans inside its own viewport rather than squeezing");
    assert.ok(responsiveLayout.canvasWidth >= 520, "the diagram keeps a width its layout can actually use");

    const moonwell = page.getByRole("button", { name: /Moonwell, Source/ });
    await moonwell.focus();
    const beforeLeft = await moonwell.evaluate((element) => Number.parseFloat(element.style.left));
    await moonwell.press("ArrowRight");
    const afterLeft = await moonwell.evaluate((element) => Number.parseFloat(element.style.left));
    assert.ok(
      Math.abs(afterLeft - (beforeLeft + 2)) < 0.001,
      `arrow keys nudge a focused rune by two percent of the canvas (moved ${afterLeft - beforeLeft})`,
    );

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload({ waitUntil: "networkidle" });
    await assertVisible(page.getByText("7 WebMCP tools registered", { exact: true }), "production WebMCP registration names the protocol");
    const registeredNames = await page.evaluate(() => [...window.__hexWebMCPTools.keys()].sort());
    assert.deepEqual(registeredNames, [
      "apply_spell_patch",
      "explain_side_effect",
      "inspect_spell",
      "propose_spell_patch",
      "set_sacred_constraint",
      "simulate_cast",
      "trace_effect",
    ]);
    const invokeTool = (name, input = {}) => page.evaluate(
      async ({ toolName, toolInput }) => {
        const definition = window.__hexWebMCPTools.get(toolName);
        if (!definition) throw new Error(`Unregistered tool: ${toolName}`);
        return definition.execute(toolInput, { signal: new AbortController().signal });
      },
      { toolName: name, toolInput: input },
    );

    const completeInspection = await invokeTool("inspect_spell");
    assert.equal(Object.hasOwn(completeInspection, "semantics"), false, "registered inspection hides simulator roles");
    assert.equal(completeInspection.graphVersion, 1);
    assert.equal(completeInspection.nodes.length, 12);
    assert.equal(completeInspection.edges.length, 4);
    assert.deepEqual(completeInspection.boundaryEdges, []);
    assert.equal(completeInspection.filter.applied, false);
    assert.equal(completeInspection.scenarioState.status, "unstable");
    assert.equal(Object.hasOwn(completeInspection.scenarioState, "assertions"), false, "inspection does not pre-solve the cast");
    assert.deepEqual(completeInspection.scenarioState.activeSideEffectIds, ["flooded-observatory"]);
    const focusedInspection = await invokeTool("inspect_spell", { nodeIds: ["multiply", "summon-ducks"] });
    assert.deepEqual(focusedInspection.edges.map((edge) => edge.id), ["e-multiply-ducks"]);
    assert.deepEqual(focusedInspection.boundaryEdges.map((edge) => edge.id), ["e-water-multiply", "e-ducks-pour"]);
    assert.equal(focusedInspection.filter.omittedNodeCount, 10);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v1/, "inspection does not advance the graph");
    const agentFailure = await invokeTool("simulate_cast");
    assert.equal(agentFailure.success, false);
    await assertVisible(page.getByText("Twelve ducks. One indoor lake.", { exact: true }), "agent simulation drives the visible failure");
    const agentTrace = await invokeTool("trace_effect", { effectId: "flooded-observatory" });
    assert.deepEqual(agentTrace.paths[0].nodeIds, ["moonwell", "multiply", "summon-ducks", "pour", "room"]);
    assert.deepEqual(agentTrace.paths[0].edgeIds, ["e-water-multiply", "e-multiply-ducks", "e-ducks-pour", "e-pour-room"]);
    assert.equal(agentTrace.paths[0].complete, true);
    assert.deepEqual(agentTrace.cycles, []);
    assert.deepEqual(agentTrace.typeViolations, []);
    const boundedSourceTrace = await invokeTool("trace_effect", { sourceId: "moonwell", maxDepth: 2, maxPaths: 1 });
    assert.equal(boundedSourceTrace.truncated, true);
    assert.deepEqual(boundedSourceTrace.bounds, { maxDepth: 2, maxPaths: 1 });
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v1/, "read-only traces do not advance the graph");
    const agentExplanation = await invokeTool("explain_side_effect", { sideEffectId: "flooded-observatory" });
    assert.deepEqual(agentExplanation.subgraph.nodes.map((node) => node.id), ["moonwell", "multiply", "summon-ducks", "pour", "room"]);
    assert.deepEqual(agentExplanation.subgraph.edges.map((edge) => edge.id), ["e-water-multiply", "e-multiply-ducks", "e-ducks-pour", "e-pour-room"]);
    assert.equal(agentExplanation.causalSteps.length, 4);
    assert.equal(agentExplanation.ruleEvidence.allPremisesSatisfied, true);
    assert.equal(agentExplanation.minimality.everyResponsibleEdgeNecessary, true);
    assert.equal(agentExplanation.minimality.necessityChecks.every((check) => !check.sideEffectStillPresent), true);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v1/, "side-effect proof does not advance the graph");
    await invokeTool("set_sacred_constraint", {
      targetId: "summon-ducks",
      reason: "The ducks are funny. They must remain in the final spell.",
    });
    await assertVisible(page.locator(".rune.sacred"), "agent constraint visibly pins the duck rune");
    const agentProposal = await invokeTool("propose_spell_patch");
    await assertVisible(page.getByRole("heading", { name: "Give the ducks umbrellas", exact: true }), "agent proposal drives the patch preview");
    assert.equal(agentProposal.patches[0].searchEvidence.editCount, 8);
    assert.equal(agentProposal.patches[0].searchEvidence.eligibleCandidateCount, 1);
    assert.deepEqual(agentProposal.patches[0].preconditions, {
      expectedGraphVersion: 2,
      requiredEdgeIds: ["e-ducks-pour", "e-pour-room"],
      requiredDormantNodeIds: ["umbrella", "bloom"],
      requiredConstraintIds: ["sacred-summon-ducks"],
    });
    assert.deepEqual(
      await page.locator(".patch-ledger li p").allTextContents(),
      agentProposal.patches[0].operationLedger.map((entry) => entry.label),
      "the human review card renders the exact operation ledger returned to the agent",
    );
    assert.deepEqual(agentProposal.patches[0].reviewSummary, {
      totalOperations: 8,
      disconnectCount: 2,
      connectCount: 4,
      awakenCount: 2,
      touchedNodeIds: ["summon-ducks", "pour", "room", "umbrella", "moonflower", "bloom"],
    });
    assert.equal(await page.locator(".patch-ledger li").count(), 8, "agent proposals use the same complete human-review ledger");
    const agentPreview = await invokeTool("simulate_cast", { patchId: agentProposal.patches[0].id });
    assert.equal(agentPreview.success, true);
    assert.equal(agentPreview.preview.editorMutated, false);
    assert.equal(agentPreview.preview.baseGraphVersion, 2);
    assert.equal(agentPreview.preview.simulatedGraphVersion, 3);
    assert.deepEqual(agentPreview.patchReview.operationLedger, agentProposal.patches[0].operationLedger);
    assert.deepEqual(agentPreview.patchReview.reviewSummary, agentProposal.patches[0].reviewSummary);
    await assertVisible(page.getByText("Unapplied simulation", { exact: true }), "agent patch simulations remain visibly pending");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v2/, "agent preview does not advance the live graph");
    const agentApply = await invokeTool("apply_spell_patch", { patchId: agentProposal.patches[0].id });
    await assertVisible(page.getByText("Stable", { exact: true }), "agent patch drives the visible stable cast");
    assert.equal(agentApply.verification.success, true);
    assert.equal(agentApply.verification.assertions.duckCount, 12);
    assert.deepEqual(agentApply.validatedPreconditions, agentProposal.patches[0].preconditions);
    assert.equal(agentApply.appliedPatch.patchId, agentProposal.patches[0].id);
    assert.deepEqual(agentApply.appliedPatch.operationLedger, agentProposal.patches[0].operationLedger);
    assert.deepEqual(agentApply.appliedPatch.reviewSummary, agentProposal.patches[0].reviewSummary);
    const recentAgentActivity = await page.locator(".activity-list").innerText();
    assert.match(recentAgentActivity, /apply_spell_patch/);
    assert.match(recentAgentActivity, /simulate_cast/);
    assert.match(recentAgentActivity, /propose_spell_patch/);
    const finalVerification = await invokeTool("simulate_cast");
    assert.equal(finalVerification.success, true);
    await assertVisible(page.locator(".agent-gym-heading .complete"), "the registered agent completes a scored episode");
    assert.match(await page.locator(".agent-gym").innerText(), /complete[\s\S]*22\.5\s*\/\s*23/i);
    assert.equal(await page.getByRole("button", { name: "Export episode JSON" }).isEnabled(), true);

    const agentRevert = await invokeTool("apply_spell_patch", { revertToken: agentApply.revertToken });
    assert.equal(agentRevert.revertedPatch.patchId, agentProposal.patches[0].id);
    assert.deepEqual(agentRevert.revertedPatch.operationLedger, agentProposal.patches[0].operationLedger);
    assert.deepEqual(agentRevert.revertedPatch.reviewSummary, agentProposal.patches[0].reviewSummary);
    await assertVisible(page.getByText("Side effect detected", { exact: true }), "agent rollback restores visible failure state");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell v4/);
    assert.equal(await page.locator(".rune.sacred").count(), 1, "agent rollback preserves sacred intent");

    assert.deepEqual(browserErrors, [], `production browser emitted errors:\n${browserErrors.join("\n")}`);
    assert.deepEqual(externalRequests, [], `production journey contacted external origins:\n${externalRequests.join("\n")}`);
  } catch (error) {
    const serverOutput = server.output();
    if (serverOutput) error.message += `\nProduction server output:\n${serverOutput}`;
    throw error;
  } finally {
    await browser?.close();
    stopProcess(server.child);
    await waitForExit(server.child);
  }
});
