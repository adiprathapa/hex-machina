import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
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
    const computedFonts = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      semanticLabel: getComputedStyle(document.querySelector(".eyebrow")).fontFamily,
    }));
    assert.match(computedFonts.body, /Poppins/i, "the production body uses the intended display typeface");
    assert.match(computedFonts.semanticLabel, /Fira Code/i, "semantic labels use the intended code typeface");
    await page.getByRole("button", { name: /Cast spell/ }).click();
    await assertVisible(page.getByText("Twelve ducks. One indoor lake.", { exact: true }), "failure spectacle is visible");
    await assertVisible(page.getByText("Side effect detected", { exact: true }), "failure state is visible");

    await page.getByRole("button", { name: "Trace the glitch", exact: true }).click();
    await assertVisible(page.getByRole("button", { name: "Protect the ducks", exact: true }), "constraint action is available");
    await page.getByRole("button", { name: "Protect the ducks", exact: true }).click();
    await assertVisible(page.locator(".rune.sacred"), "the duck rune visibly carries its sacred constraint");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v2/);

    await page.getByRole("button", { name: "Find a repair", exact: true }).click();
    await assertVisible(page.getByRole("heading", { name: "Give the ducks umbrellas", exact: true }), "constraint-aware patch is previewed");
    assert.match(await page.locator(".patch-card").innerText(), /RANK\s+#1[\s\S]*EDITS\s+8[\s\S]*ELIGIBLE\s+1\/2/i);
    const patchLedger = page.locator(".patch-ledger");
    await assertVisible(patchLedger, "the human can inspect every proposed structural mutation before approval");
    assert.equal(await patchLedger.locator("li").count(), 8, "the ledger accounts for all eight graph edits");
    assert.match(await patchLedger.innerText(), /Disconnect Summon ducks → Pour · flows to/);
    assert.match(await patchLedger.innerText(), /Connect Pour → Moonflower · targets/);
    assert.match(await patchLedger.innerText(), /Awaken Umbrella/);
    const patchPreflight = page.locator(".patch-preflight");
    await assertVisible(patchPreflight, "the approval card exposes exact structural preconditions");
    assert.match(await patchPreflight.innerText(), /Preflight · graph v2[\s\S]*2 live edges · 2 dormant runes · 1 sacred lock/i);
    assert.equal(await page.locator(".edge-layer line.patch-remove").count(), 2, "removed connections are previewed on the graph");
    assert.equal(await page.locator(".edge-layer line.patch-add").count(), 4, "new connections are previewed on the graph");
    assert.equal(await page.locator(".rune.patch-activate").count(), 2, "dormant runes to awaken are previewed on the graph");
    await page.getByRole("button", { name: "Simulate patch safely", exact: true }).click();
    await assertVisible(page.getByText("Unapplied simulation", { exact: true }), "a human can safely test the repair before approval");
    await assertVisible(page.locator(".preview-verdict"), "the unapplied prediction is visibly distinguished from editor state");
    assert.match(await page.locator(".preview-verdict").innerText(), /Predicted\s+Stable[\s\S]*Editor remains at graph v2/i);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v2/, "preview simulation does not advance the graph");
    await page.getByRole("button", { name: "Apply patch & recast", exact: true }).click();
    await assertVisible(page.getByText("Stable", { exact: true }), "successful cast is stable");
    await assertVisible(page.getByText("The moonflower blooms", { exact: true }), "successful outcome is visible");
    assert.match(await page.locator(".cast-vision").innerText(), /twelve umbrella-equipped ducks/i);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v3/);
    assert.equal(await page.locator(".rune.sacred").count(), 1, "the repaired spell preserves one sacred rune");

    await page.getByRole("button", { name: "Undo agent patch", exact: true }).click();
    await assertVisible(page.getByText("Side effect detected", { exact: true }), "undo restores the failed spell");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v4/);
    assert.equal(await page.locator(".rune.sacred").count(), 1, "undo preserves the human's sacred constraint");

    await page.getByRole("button", { name: "Reset lesson", exact: true }).click();
    await assertVisible(page.getByText("Ready to cast", { exact: true }), "reset returns to the initial state");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v1/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await assertVisible(page.locator(".mission-chip"), "the compact objective remains visible");
    const responsiveLayout = await page.evaluate(() => {
      const brief = document.querySelector(".brief-panel")?.getBoundingClientRect();
      const canvas = document.querySelector(".canvas-panel")?.getBoundingClientRect();
      const linkButton = document.querySelector(".start-link")?.getBoundingClientRect();
      return {
        briefTop: brief?.top,
        canvasTop: canvas?.top,
        linkHeight: linkButton?.height,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    assert.ok(responsiveLayout.briefTop < responsiveLayout.canvasTop, "onboarding precedes the graph on mobile");
    assert.equal(responsiveLayout.horizontalOverflow, false, "mobile layout does not overflow horizontally");
    assert.ok(responsiveLayout.linkHeight >= 44, "compact graph controls retain a 44px touch target");

    const moonwell = page.getByRole("button", { name: /Moonwell, Source/ });
    await moonwell.focus();
    const beforeLeft = await moonwell.evaluate((element) => Number.parseFloat(element.style.left));
    await moonwell.press("ArrowRight");
    const afterLeft = await moonwell.evaluate((element) => Number.parseFloat(element.style.left));
    assert.equal(afterLeft, beforeLeft + 2, "arrow keys nudge a focused rune by two percent");

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload({ waitUntil: "networkidle" });
    await assertVisible(page.getByText("7 site tools live", { exact: true }), "production WebMCP registration is visible");
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
    assert.equal(completeInspection.graphVersion, 1);
    assert.equal(completeInspection.nodes.length, 12);
    assert.equal(completeInspection.edges.length, 4);
    assert.deepEqual(completeInspection.boundaryEdges, []);
    assert.equal(completeInspection.filter.applied, false);
    assert.equal(completeInspection.scenarioState.status, "unstable");
    assert.equal(completeInspection.scenarioState.assertions.duckCount, 12);
    assert.deepEqual(completeInspection.scenarioState.activeSideEffectIds, ["flooded-observatory"]);
    const focusedInspection = await invokeTool("inspect_spell", { nodeIds: ["multiply", "summon-ducks"] });
    assert.deepEqual(focusedInspection.edges.map((edge) => edge.id), ["e-multiply-ducks"]);
    assert.deepEqual(focusedInspection.boundaryEdges.map((edge) => edge.id), ["e-water-multiply", "e-ducks-pour"]);
    assert.equal(focusedInspection.filter.omittedNodeCount, 10);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v1/, "inspection does not advance the graph");
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
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v1/, "read-only traces do not advance the graph");
    const agentExplanation = await invokeTool("explain_side_effect", { sideEffectId: "flooded-observatory" });
    assert.deepEqual(agentExplanation.subgraph.nodes.map((node) => node.id), ["moonwell", "multiply", "summon-ducks", "pour", "room"]);
    assert.deepEqual(agentExplanation.subgraph.edges.map((edge) => edge.id), ["e-water-multiply", "e-multiply-ducks", "e-ducks-pour", "e-pour-room"]);
    assert.equal(agentExplanation.causalSteps.length, 4);
    assert.equal(agentExplanation.ruleEvidence.allPremisesSatisfied, true);
    assert.equal(agentExplanation.minimality.everyResponsibleEdgeNecessary, true);
    assert.equal(agentExplanation.minimality.necessityChecks.every((check) => !check.sideEffectStillPresent), true);
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v1/, "side-effect proof does not advance the graph");
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
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v2/, "agent preview does not advance the live graph");
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

    const agentRevert = await invokeTool("apply_spell_patch", { revertToken: agentApply.revertToken });
    assert.equal(agentRevert.revertedPatch.patchId, agentProposal.patches[0].id);
    assert.deepEqual(agentRevert.revertedPatch.operationLedger, agentProposal.patches[0].operationLedger);
    assert.deepEqual(agentRevert.revertedPatch.reviewSummary, agentProposal.patches[0].reviewSummary);
    await assertVisible(page.getByText("Side effect detected", { exact: true }), "agent rollback restores visible failure state");
    assert.match(await page.locator(".canvas-header").textContent(), /Live spell · v4/);
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
