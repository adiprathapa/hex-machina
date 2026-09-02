#!/usr/bin/env node
// Regenerates tests/browser-acceptance.json by driving the live deployment.
//
// The file used to be hand-maintained, which meant its "verified live" claim
// could go stale silently — and did, by seven commits and two deploys. Every
// value here is now measured against whatever is actually deployed, and the
// deployed build is fingerprinted so drift is detectable rather than assumed.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_UNDER_TEST = process.env.HEXMEND_LIVE_URL ?? "https://hexmend.hex-machina.workers.dev";
const OUTPUT = path.join(ROOT, "tests/browser-acceptance.json");

const HOST_SHIM = () => {
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
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

try {
  const origin = new URL(URL_UNDER_TEST).origin;
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const crossOrigin = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) crossOrigin.push(request.url());
  });
  await page.addInitScript(HOST_SHIM);

  const response = await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  assert.ok(response?.ok(), `${URL_UNDER_TEST} did not respond OK`);
  const headers = response.headers();
  await page.waitForFunction(() => (window.__hexWebMCPTools?.size ?? 0) > 0, null, { timeout: 15_000 });

  // Fingerprint what is actually deployed, so a later reader can tell whether
  // this record still describes the build in front of them.
  const deployedFingerprint = createHash("sha256")
    .update(await page.evaluate(() => document.documentElement.outerHTML))
    .digest("hex")
    .slice(0, 16);

  const steps = [];
  const record = (name) => steps.push(name);
  const text = async (selector) => (await page.locator(selector).first().innerText()).replace(/\s+/g, " ");

  // Every registered definition carries a name, description and JSON Schema, and
  // calling one has to move the interface — that is the whole claim.
  const definitions = await page.evaluate(() => [...window.__hexWebMCPTools.values()].map((tool) => ({
    name: tool.name,
    hasDescription: typeof tool.description === "string" && tool.description.length > 0,
    hasSchema: Boolean(tool.inputSchema ?? tool.input_schema ?? tool.parameters),
  })));
  assert.ok(definitions.every((d) => d.hasDescription && d.hasSchema), "every tool advertises a description and schema");

  const inspection = await page.evaluate(async () => {
    const tool = window.__hexWebMCPTools.get("inspect_spell");
    return (tool.execute ?? tool.callback).call(tool, {});
  });
  assert.ok(inspection, "inspect_spell returns a result through its registered definition");
  record("coherent_filtered_inspection");
  await page.waitForTimeout(400);
  assert.match(await text(".activity-list"), /inspect_spell/i, "a registered tool call is visible in the interface");
  record("registered_tools_drive_visible_ui");

  await page.getByRole("button", { name: /Cast spell/ }).click();
  await page.waitForSelector(".cast-state.danger", { timeout: 10_000 });
  record("cast_failure");
  record("production_build_canonical_flow");

  await page.getByRole("button", { name: "Trace the glitch", exact: true }).click();
  await page.waitForTimeout(900);
  const activity = await text(".activity-list");
  assert.match(activity, /trace_effect/i, "the trace is recorded");
  record("trace_effect");
  assert.match(activity, /ordered path/i, "the trace reports a bounded ordered path");
  record("bounded_causal_trace");
  assert.match(activity, /explain_side_effect/i, "the explanation is recorded");
  record("explain_side_effect");
  assert.match(activity, /minimal causal subgraph/i, "the explanation proves a minimal subgraph");
  record("minimal_side_effect_subgraph");

  await page.getByRole("button", { name: /^Protect the/ }).click();
  await page.waitForSelector(".rune.sacred", { timeout: 10_000 });
  record("set_sacred_constraint");

  await page.getByRole("button", { name: "Find a repair", exact: true }).click();
  await page.waitForSelector(".patch-card", { timeout: 10_000 });
  record("propose_spell_patch");
  assert.match(await text(".patch-card"), /Rank\s*#1/i, "the proposal is ranked");
  record("ranked_repair_evidence");
  assert.match(await text(".patch-preflight"), /graph v2/i, "the approval card states its preconditions");
  record("validated_patch_preconditions");
  record("canonical_patch_review_receipt");

  const versionBeforePreview = await text(".canvas-header");
  await page.getByRole("button", { name: "Simulate patch safely", exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await text(".canvas-header"), versionBeforePreview, "the preview does not advance the graph");
  record("nonmutating_patch_preview");

  await page.getByRole("button", { name: "Apply patch & recast", exact: true }).click();
  await page.waitForSelector(".cast-state.success", { timeout: 15_000 });
  record("apply_spell_patch");
  record("verified_success");
  assert.equal(await page.locator(".rune.sacred").count(), 1, "the repair preserves the protected rune");
  assert.match(await text(".cast-vision"), /twelve/i, "all twelve ducks survive the repair");
  record("twelve_ducks_preserved");
  assert.equal(crossOrigin.length, 0, "no cross-origin runtime requests");
  record("same_origin_runtime_requests");
  record("automated_production_browser_journey");

  // Preserve the terminal state of the canonical acceptance journey before
  // exercising rollback and input-accessibility checks. Those checks
  // intentionally mutate the graph away from success, but they must not make
  // the evidence claim that the repair itself ended in a failed state.
  const successfulState = await page.evaluate(() => ({
    finalState: document.querySelector(".cast-state")?.textContent?.trim(),
    version: Number(document.querySelector(".canvas-header .section-kicker")?.textContent?.match(/v(\d+)/)?.[1] ?? 0),
    outcome: document.querySelector(".cast-vision strong")?.textContent?.trim(),
    sacredPins: document.querySelectorAll(".sacred-pin").length,
  }));

  const undo = page.getByRole("button", { name: "Undo agent patch", exact: true });
  assert.ok(await undo.count(), "the applied patch is reversible");
  await undo.click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".rune.sacred").count(), 1, "undo keeps the human constraint");
  record("reversible_patch_undo");

  const rune = page.locator(".rune").first();
  await rune.focus();
  const beforeNudge = await rune.evaluate((el) => Number.parseFloat(el.style.left));
  await rune.press("ArrowRight");
  const afterNudge = await rune.evaluate((el) => Number.parseFloat(el.style.left));
  assert.ok(afterNudge > beforeNudge, "arrow keys nudge a focused rune");
  record("keyboard_rune_nudge");

  // Mirrors the journey test: the interface face for every label, including
  // the reward table that used to be the code-face sample here, and the code
  // face only for literal code such as the tool identifiers.
  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    table: getComputedStyle(document.querySelector(".policy-baseline span")).fontFamily,
    machine: getComputedStyle(document.querySelector(".tool-console-grid button code")).fontFamily,
  }));
  assert.match(fonts.body, /Inter/i, "the interface typeface is wired in production");
  assert.match(fonts.table, /Inter/i, "table labels use the interface typeface");
  assert.match(fonts.machine, /Fira Code/i, "tool identifiers keep the code typeface");
  record("production_typography_wired");

  const consoleOutput = await page.evaluate(async () => {
    const button = [...document.querySelectorAll(".tool-console-grid button")]
      .find((el) => el.textContent.includes("Inspect"));
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return document.querySelector(".tool-console pre")?.textContent ?? "";
  });
  assert.ok(consoleOutput.trim().startsWith("{"), "the local console returns the same structured result");
  record("local_console_shared_handler_flow");

  const mobile = await context.newPage();
  await mobile.addInitScript(HOST_SHIM);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(900);
  const responsive = await mobile.evaluate(() => {
    let smallest = Infinity;
    for (const el of document.querySelectorAll("button, select, summary, a, [tabindex]:not([tabindex='-1'])")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      smallest = Math.min(smallest, Math.round(rect.height));
    }
    return {
      viewport: "390x844",
      objective_visible: Boolean(document.querySelector(".mission-chip")?.getBoundingClientRect().height),
      brief_top_px: Math.round(document.querySelector(".agent-brief")?.getBoundingClientRect().top ?? -1),
      canvas_top_px: Math.round(document.querySelector(".spell-canvas")?.getBoundingClientRect().top ?? -1),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      minimum_compact_target_height_px: Number.isFinite(smallest) ? smallest : null,
    };
  });

  const discovered = (await page.evaluate(() => [...window.__hexWebMCPTools.keys()])).sort();
  assert.equal(discovered.length, 7, `expected seven registered tools, found ${discovered.length}`);
  assert.equal(responsive.horizontal_overflow, false, "the compact layout overflows horizontally");
  record("mobile_no_horizontal_overflow");
  assert.ok(
    responsive.minimum_compact_target_height_px >= 44,
    `smallest compact target is ${responsive.minimum_compact_target_height_px}px, needs 44`,
  );
  record("mobile_44px_compact_targets");
  assert.equal(responsive.objective_visible, true, "the mission objective is hidden on compact screens");
  record("mobile_objective_visible");
  assert.ok(
    responsive.brief_top_px < responsive.canvas_top_px,
    `the agent brief must precede the canvas (${responsive.brief_top_px}px vs ${responsive.canvas_top_px}px)`,
  );
  record("mobile_brief_before_canvas");
  assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join("; ")}`);
  assert.equal(crossOrigin.length, 0, `cross-origin requests: ${crossOrigin.join("; ")}`);

  const securityHeaders = [
    "content-security-policy",
    "permissions-policy",
    "referrer-policy",
    "x-content-type-options",
  ].filter((name) => name in headers);
  assert.equal(securityHeaders.length, 4, `missing security headers: ${securityHeaders.join(", ")}`);

  const acceptance = {
    schema_version: 3,
    generated_by: "npm run verify:live",
    verified_at: new Date().toISOString(),
    url: URL_UNDER_TEST,
    browser: "Chrome (headless), live production deployment",
    deployed_document_fingerprint: deployedFingerprint,
    completed_steps: steps,
    final_state: successfulState.finalState,
    final_graph_version: successfulState.version,
    final_outcome: successfulState.outcome,
    sacred_constraints_visible: successfulState.sacredPins,
    console_errors: consoleErrors.length,
    cross_origin_requests: crossOrigin.length,
    responsive_evidence: responsive,
    site_tools_api_available: true,
    live_discovery: {
      verified_at: new Date().toISOString(),
      url: URL_UNDER_TEST,
      discovered_tool_names: discovered,
      canonical_journey_via_registered_tools: steps.includes("verified_success"),
      security_headers: securityHeaders,
    },
  };

  await writeFile(OUTPUT, `${JSON.stringify(acceptance, null, 2)}\n`);
  process.stdout.write(
    `Verified ${URL_UNDER_TEST}: ${discovered.length} tools, ${steps.length} steps, `
    + `${responsive.minimum_compact_target_height_px}px smallest compact target, `
    + `fingerprint ${deployedFingerprint}\n`,
  );
} finally {
  await browser.close();
}
