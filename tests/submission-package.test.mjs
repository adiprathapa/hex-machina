import assert from "node:assert/strict";
import { readFile, readdir, stat, mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_BROWSER_ACCEPTANCE_STEPS = [
  "cast_failure",
  "trace_effect",
  "explain_side_effect",
  "set_sacred_constraint",
  "propose_spell_patch",
  "apply_spell_patch",
  "verified_success",
  "production_build_canonical_flow",
  "mobile_objective_visible",
  "mobile_brief_before_canvas",
  "mobile_no_horizontal_overflow",
  "mobile_44px_compact_targets",
  "keyboard_rune_nudge",
  "automated_production_browser_journey",
  "reversible_patch_undo",
  "registered_tools_drive_visible_ui",
  "same_origin_runtime_requests",
  "ranked_repair_evidence",
  "nonmutating_patch_preview",
  "bounded_causal_trace",
  "coherent_filtered_inspection",
  "validated_patch_preconditions",
  "twelve_ducks_preserved",
];

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.name.endsWith(".md") ? [absolute] : [];
  }));
  return nested.flat();
}

test("all local Markdown links in the judge package resolve", async () => {
  const files = [
    path.join(ROOT, "README.md"),
    path.join(ROOT, "CONTRIBUTING.md"),
    ...await markdownFiles(path.join(ROOT, "submission")),
  ];
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, "").split("#", 1)[0];
      if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
      try {
        await stat(resolved);
      } catch {
        missing.push(`${path.relative(ROOT, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("public source package contains no root-level analysis probes", async () => {
  const entries = await readdir(ROOT, { withFileTypes: true });
  const probes = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => (
      /^_?skep/i.test(name)
      || /^\.audit-/i.test(name)
      || /^vis(?:-|\d).*\.ts$/i.test(name)
    ))
    .sort();
  assert.deepEqual(probes, [], "throwaway localhost/browser probes do not belong in the judge-facing repository");
});

test("generated live-browser evidence satisfies the full acceptance contract", async () => {
  const evidence = JSON.parse(await readFile(path.join(ROOT, "tests/browser-acceptance.json"), "utf8"));
  const completed = new Set(evidence.completed_steps);
  assert.deepEqual(
    REQUIRED_BROWSER_ACCEPTANCE_STEPS.filter((step) => !completed.has(step)),
    [],
    "npm run verify:live must record every full-suite interaction receipt",
  );
  assert.equal(evidence.final_state, "Stable", "the recorded canonical journey must end in the repaired state");
  assert.equal(evidence.console_errors, 0);
  assert.equal(evidence.cross_origin_requests, 0);
  assert.ok(evidence.sacred_constraints_visible >= 1);
  assert.equal(evidence.site_tools_api_available, true);
});

test("Devpost copy directly answers every required explanation and judging criterion", async () => {
  const copy = await readFile(path.join(ROOT, "submission/devpost-entry.md"), "utf8");
  for (const heading of [
    "Why this is a strong fit for WebMCP",
    "How it creates a better user experience",
    "What people and agents can do together",
    "How WebMCP was implemented",
    "WebMCP leverage",
    "Execution",
    "Potential impact",
    "Creativity and ambition",
    "How to test",
    "Build provenance",
  ]) {
    assert.match(copy, new RegExp(`^#{2,3} ${heading}$`, "mi"));
  }
  assert.match(copy, /document\.modelContext\.registerTool\(\)/);
  assert.match(copy, /all twelve ducks preserved/i);
  assert.match(copy, /Public GitHub repository with a visible open-source license/);
  assert.match(copy, /Public YouTube demo with audio/);
  assert.match(copy, /96 deterministic tasks/i);
  assert.match(copy, /one to three seeded, typed decoy edges/i);
  assert.match(copy, /at least three visible topologies/i);
  assert.match(copy, /Seeded resets select reproducibly/i);
  assert.match(copy, /family-restricted curriculum/i);
  assert.match(copy, /cross-rule grounding evidence/i);
  assert.match(copy, /omit the simulator's role map/i);
  assert.match(copy, /natural-language constraints plus inspected rune text/i);
  assert.match(copy, /rule-revealing family\/scenario names/i);
  assert.match(copy, /pre-cast diagnostic assertions/i);
  assert.match(copy, /not a learned-policy result/i);
  assert.match(copy, /JSONL exporter/i);
  assert.match(copy, /independent bounded verifier/i);
  assert.match(copy, /altered metadata, actions, rewards/i);
  assert.match(copy, /duplicate scenarios/i);
  assert.match(copy, /termination\/truncation flags/i);
  assert.match(copy, /32 actions/i);
  assert.match(copy, /streaming JSONL service/i);
  assert.match(copy, /Python adapters/i);
  assert.match(copy, /isolated parallel vectors/i);
  assert.match(copy, /contrast suite/i);
  assert.match(copy, /canonical-ID memorization \(−8\)/i);
});

test("release evidence records local proof and never overclaims an external gate", async () => {
  const evidence = JSON.parse(await readFile(path.join(ROOT, "submission/release-evidence.json"), "utf8"));
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.project.created_during_submission_period, true);
  assert.match(evidence.project.first_commit, /^[a-f0-9]{7,40}$/);
  assert.ok(Date.parse(evidence.project.first_commit_at) >= Date.parse("2026-08-25T11:00:00-07:00"));
  assert.equal(evidence.devpost.copy_ready, true);
  // The challenge caps the demo at under three minutes; the exact length is a
  // production choice, so the evidence is checked against the rule.
  assert.ok(evidence.video.duration_seconds > 20 && evidence.video.duration_seconds < 180);
  assert.equal(evidence.video.has_audio, true);
  assert.ok((await stat(path.join(ROOT, evidence.video.local_path))).size > 500_000);
  // Release fields are checked for consistency rather than pinned to the
  // unreleased state, which would make an actual release fail the suite. What
  // must never happen is claiming a release step that has not happened: each
  // claim below requires the artefact it depends on.
  const { repository, site, video } = evidence;

  assert.equal(typeof repository.public, "boolean");
  if (repository.public) {
    assert.match(
      repository.url,
      /^https:\/\/(?:www\.)?(?:github|gitlab|bitbucket)\.[^\s/]+\/.+/,
      "a public repository must record where it is",
    );
    assert.ok(
      typeof repository.license_spdx === "string" && repository.license_spdx.trim().length > 0,
      "the challenge requires a visible open-source license on a public repository",
    );
  }

  // Selecting the license before publishing is the correct order, so it is
  // checked independently of `public`. What it must not be is a claim: a
  // recorded license has to exist as a file in the repository.
  if (repository.license_spdx !== null) {
    assert.ok(
      (await stat(path.join(ROOT, "LICENSE"))).size > 0,
      "the recorded license must exist in the repository, not only in the evidence",
    );
  }

  if (site.live_url !== null) {
    assert.match(site.live_url, /^https:\/\/[^\s/]+(?:\/.*)?$/);
  }
  assert.equal(typeof site.webmcp_discovered_live, "boolean");
  if (site.webmcp_discovered_live) {
    assert.ok(site.live_url, "live tool discovery cannot be claimed without a live site");
  }

  if (video.public_youtube_url !== null) {
    assert.match(
      video.public_youtube_url,
      /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]+/,
    );
  }

  assert.equal(evidence.devpost.submitted, evidence.devpost.submitted === true);
});

test("captions describe and cover the real registered-tool screencast", async () => {
  const captions = await readFile(path.join(ROOT, "submission/video/captions.srt"), "utf8");
  const metadata = JSON.parse(await readFile(path.join(ROOT, "submission/video/metadata.json"), "utf8"));
  const timestamps = [...captions.matchAll(
    /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g,
  )];
  assert.ok(timestamps.length >= 20, "the final screencast needs readable caption beats");
  const seconds = (match, offset) => (
    Number(match[offset]) * 3600
    + Number(match[offset + 1]) * 60
    + Number(match[offset + 2])
    + Number(match[offset + 3]) / 1000
  );
  let previousEnd = 0;
  for (const timestamp of timestamps) {
    const start = seconds(timestamp, 1);
    const end = seconds(timestamp, 5);
    assert.ok(start >= previousEnd, "caption cues must be ordered and non-overlapping");
    assert.ok(end > start, "every caption cue must have positive duration");
    previousEnd = end;
  }
  const videoDuration = Number(metadata.format.duration);
  assert.ok(Math.abs(previousEnd - videoDuration) < 1, "captions must cover the final video tail");
  assert.match(captions, /document\.modelContext/);
  assert.match(captions, /stands in for a WebMCP host/);
  assert.match(captions, /tool call, not a click/);
  assert.doesNotMatch(
    captions,
    /Nobody is clicking/,
    "the recorder clicks through the task swap, so the narration must not claim otherwise",
  );
  assert.match(captions, /held-out one/);
  assert.match(captions, /freshly remapped/);
});

test("release operator can safely record an already-public YouTube URL", async () => {
  const sourcePath = path.join(ROOT, "submission/release-evidence.json");
  const original = JSON.parse(await readFile(sourcePath, "utf8"));
  const directory = await mkdtemp(path.join(tmpdir(), "hexmend-release-"));
  const evidencePath = path.join(directory, "release-evidence.json");
  await writeFile(evidencePath, `${JSON.stringify(original, null, 2)}\n`);

  const invalid = spawnSync(
    "python3",
    [path.join(ROOT, "train.py"), "record-youtube", "https://example.com/not-youtube", "--evidence", evidencePath],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Expected a public YouTube/);
  assert.deepEqual(JSON.parse(await readFile(evidencePath, "utf8")), original, "invalid input leaves release evidence untouched");

  const publicUrl = "https://youtu.be/AbC_123-xyZ";
  const valid = spawnSync(
    "python3",
    [path.join(ROOT, "train.py"), "record-youtube", publicUrl, "--evidence", evidencePath],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(valid.status, 0, valid.stderr);
  const recorded = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.equal(recorded.video.public_youtube_url, publicUrl);
  recorded.video.public_youtube_url = original.video.public_youtube_url;
  assert.deepEqual(recorded, original, "the recorder changes only the public video URL");
});

test("YouTube handoff covers every official media requirement", async () => {
  const handoff = await readFile(path.join(ROOT, "submission/video/youtube-upload.md"), "utf8");
  assert.match(handoff, /Public \(not Unlisted\)/);
  assert.match(handoff, /less than three minutes/i);
  assert.match(handoff, /audio/i);
  assert.match(handoff, /no third-party music/i);
  assert.match(handoff, /captions\.srt/);
  assert.match(handoff, /python3 train\.py record-youtube/);
  assert.match(handoff, /https:\/\/hexmend\.hex-machina\.workers\.dev/);
  assert.match(handoff, /https:\/\/github\.com\/adiprathapa\/hexmend/);
});

test("every npm command the judge package advertises actually exists", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const docs = ["README.md", "submission/devpost-entry.md", "submission/agent-gym-adversarial-audit.md",
    "submission/acceptance-matrix.md", "submission/deployment.md", "submission/description.md",
    "submission/video/README.md", "submission/screenshots/README.md"];

  // Two documents advertised `npm run gym:replay` under headings promising that
  // every number regenerates. It has never existed. A judge's first copy-paste
  // from the reproducibility block exited non-zero.
  const missing = [];
  for (const doc of docs) {
    let text;
    try {
      text = await readFile(new URL(`../${doc}`, import.meta.url), "utf8");
    } catch {
      continue;
    }
    for (const [, name] of text.matchAll(/npm run (?:--silent )?([a-z0-9:_-]+)/g)) {
      if (!(name in scripts)) missing.push(`${doc}: npm run ${name}`);
    }
  }

  assert.deepEqual([...new Set(missing)], [], "the judge package advertises npm scripts that do not exist");
});
