#!/usr/bin/env python3
"""Acceptance harness for Hexmend.

The harness is intentionally useful before scaffolding: missing product pieces
are reported as actionable failures. As the app appears, it discovers and runs
its declared package scripts. Use --quick for frequent local feedback; the full
mode additionally requires and runs browser/E2E coverage.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent
REQUIRED_TOOLS = {
    "inspect_spell",
    "trace_effect",
    "simulate_cast",
    "explain_side_effect",
    "set_sacred_constraint",
    "propose_spell_patch",
    "apply_spell_patch",
}
IGNORED_DIRS = {
    ".git",
    ".next",
    "coverage",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
    "work",
}


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


def source_files() -> list[Path]:
    extensions = {".js", ".jsx", ".mjs", ".ts", ".tsx"}
    result: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in extensions:
            continue
        if any(part in IGNORED_DIRS for part in path.relative_to(ROOT).parts):
            continue
        result.append(path)
    return result


def source_text(files: Iterable[Path]) -> str:
    chunks: list[str] = []
    for path in files:
        try:
            chunks.append(path.read_text(encoding="utf-8"))
        except UnicodeDecodeError:
            pass
    return "\n".join(chunks)


def load_package() -> tuple[dict, Check]:
    package_path = ROOT / "package.json"
    if not package_path.exists():
        return {}, Check(
            "package manifest",
            False,
            "package.json is missing; scaffold the TypeScript web application",
        )
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        return {}, Check("package manifest", False, f"invalid package.json: {error}")
    return package, Check("package manifest", True, "package.json parsed")


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise ValueError("not a valid JPEG header")
    offset = 2
    start_of_frame = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while offset + 8 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9}:
            continue
        if offset + 2 > len(data):
            break
        segment_length = struct.unpack(">H", data[offset:offset + 2])[0]
        if segment_length < 2 or offset + segment_length > len(data):
            break
        if marker in start_of_frame:
            height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
            return width, height
        offset += segment_length
    raise ValueError("JPEG dimensions not found")


def screenshot_capture_check(relative_path: str, expected_size: tuple[int, int] = (1280, 720)) -> Check:
    path = ROOT / relative_path
    try:
        data = path.read_bytes()
        width, height = jpeg_dimensions(data)
    except (OSError, ValueError, struct.error) as error:
        return Check(f"screenshot {relative_path}", False, str(error))
    valid = (width, height) == expected_size and len(data) >= 50_000
    return Check(
        f"screenshot {relative_path}",
        valid,
        f"{width}×{height}, {len(data) // 1024} KiB" if valid else f"expected {expected_size[0]}×{expected_size[1]} JPEG >= 50 KiB; received {width}×{height}, {len(data) // 1024} KiB",
    )


def demo_video_check() -> Check:
    video_path = ROOT / "submission" / "video" / "hexmend-demo.mp4"
    metadata_path = ROOT / "submission" / "video" / "metadata.json"
    try:
        header = video_path.read_bytes()[:32]
        size = video_path.stat().st_size
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        duration = float(metadata["format"]["duration"])
        streams = metadata["streams"]
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Check("narrated demo video", False, str(error))

    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    valid = all(
        (
            b"ftyp" in header,
            size >= 500_000,
            20.0 <= duration < 180.0,
            video_stream is not None,
            audio_stream is not None,
            video_stream is not None and video_stream.get("codec_name") == "h264",
            video_stream is not None and video_stream.get("width") == 1920,
            video_stream is not None and video_stream.get("height") == 1080,
            audio_stream is not None and audio_stream.get("codec_name") == "aac",
        )
    )
    detail = f"{duration:.1f}s H.264/AAC, 1920×1080, {size // 1024} KiB"
    return Check("narrated demo video", valid, detail if valid else f"invalid media evidence: {detail}")


def browser_evidence_check(require_site_tools: bool) -> Check:
    evidence_path = ROOT / "tests" / "browser-acceptance.json"
    if not evidence_path.exists():
        return Check("browser acceptance evidence", False, "tests/browser-acceptance.json is missing")
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        return Check("browser acceptance evidence", False, f"invalid evidence: {error}")

    required_steps = {
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
    }
    completed = set(evidence.get("completed_steps", []))
    problems: list[str] = []
    if not required_steps.issubset(completed):
        problems.append("missing interaction steps")
    if evidence.get("final_state") != "Stable":
        problems.append("final state is not Stable")
    if evidence.get("console_errors") != 0:
        problems.append("browser console errors were observed")
    if evidence.get("sacred_constraints_visible", 0) < 1:
        problems.append("sacred constraint was not visibly preserved")
    if require_site_tools and evidence.get("site_tools_api_available") is not True:
        problems.append("live document.modelContext discovery is not yet verified")

    return Check(
        "browser acceptance evidence",
        not problems,
        "full interaction and live Site Tools verified" if not problems else "; ".join(problems),
    )


def release_evidence_checks(require_external: bool) -> list[Check]:
    evidence_path = ROOT / "submission" / "release-evidence.json"
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        project = evidence["project"]
        site = evidence["site"]
        repository = evidence["repository"]
        video = evidence["video"]
        devpost = evidence["devpost"]
        local_video = ROOT / video["local_path"]
        local_problems: list[str] = []
        if evidence.get("schema_version") != 1:
            local_problems.append("unsupported schema version")
        if project.get("created_during_submission_period") is not True:
            local_problems.append("challenge-period provenance is not recorded")
        if devpost.get("copy_ready") is not True or not (ROOT / devpost.get("copy_path", "")).is_file():
            local_problems.append("Devpost copy is not ready")
        duration_seconds = video.get("duration_seconds")
        if not isinstance(duration_seconds, (int, float)) or not (20 <= duration_seconds < 180) or video.get("has_audio") is not True:
            local_problems.append("local demo evidence is not a narrated video under the three-minute cap")
        if not local_video.is_file() or local_video.stat().st_size < 500_000:
            local_problems.append("local demo video is missing or too small")
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return [Check("challenge release evidence", False, f"invalid evidence: {error}")]

    checks = [
        Check(
            "challenge release evidence",
            not local_problems,
            "Devpost copy, provenance, and local media evidence are ready" if not local_problems else "; ".join(local_problems),
        )
    ]
    if not require_external:
        return checks

    live_url = site.get("live_url")
    live_ready = isinstance(live_url, str) and bool(re.fullmatch(r"https://[^\s/]+(?:/.*)?", live_url))
    checks.append(Check(
        "judge-accessible live URL",
        live_ready,
        live_url if live_ready else "authorized production URL has not been recorded",
    ))

    repository_url = repository.get("url")
    license_spdx = repository.get("license_spdx")
    repository_ready = (
        repository.get("public") is True
        and isinstance(repository_url, str)
        and bool(re.fullmatch(r"https://(?:www\.)?(?:github|gitlab|bitbucket)\.[^\s/]+/.+", repository_url))
        and isinstance(license_spdx, str)
        and bool(license_spdx.strip())
    )
    checks.append(Check(
        "public licensed source repository",
        repository_ready,
        f"{repository_url} ({license_spdx})" if repository_ready else "repository is private or a visible open-source license has not been selected",
    ))

    youtube_url = video.get("public_youtube_url")
    youtube_ready = isinstance(youtube_url, str) and bool(
        re.fullmatch(r"https://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)[A-Za-z0-9_-]+(?:[&?][^\s]*)?", youtube_url)
    )
    checks.append(Check(
        "public YouTube demo",
        youtube_ready,
        youtube_url if youtube_ready else "public YouTube URL with audio has not been recorded",
    ))
    return checks


def choose_runner() -> tuple[list[str], str] | None:
    candidates = [
        (ROOT / "pnpm-lock.yaml", ["pnpm"], "pnpm"),
        (ROOT / "yarn.lock", ["yarn"], "yarn"),
        (ROOT / "bun.lockb", ["bun", "run"], "bun"),
        (ROOT / "bun.lock", ["bun", "run"], "bun"),
        (ROOT / "package-lock.json", ["npm", "run"], "npm"),
    ]
    for lockfile, prefix, binary in candidates:
        if lockfile.exists() and shutil.which(binary):
            return prefix, binary
    if shutil.which("npm"):
        return ["npm", "run"], "npm"
    return None


def run_command(name: str, command: list[str], timeout: int = 240) -> Check:
    print(f"\n$ {' '.join(command)}", flush=True)
    environment = os.environ.copy()
    environment.setdefault("CI", "1")
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return Check(name, False, f"timed out after {timeout}s")
    except OSError as error:
        return Check(name, False, str(error))
    return Check(
        name,
        result.returncode == 0,
        f"exit code {result.returncode}",
    )


def script_check(
    package: dict,
    runner: tuple[list[str], str] | None,
    aliases: list[str],
    required: bool,
    timeout: int = 240,
) -> Check:
    scripts = package.get("scripts", {}) if isinstance(package, dict) else {}
    selected = next((name for name in aliases if name in scripts), None)
    label = "/".join(aliases)
    if not selected:
        return Check(
            f"script {label}",
            not required,
            "missing required script" if required else "optional script not declared",
        )
    if runner is None:
        return Check(f"script {selected}", False, "no supported JS package runner found")
    prefix, binary = runner
    if binary == "yarn":
        command = prefix + [selected]
    else:
        command = prefix + [selected]
    return run_command(f"script {selected}", command, timeout=timeout)


def static_checks(files: list[Path], combined: str) -> list[Check]:
    relative_files = [str(path.relative_to(ROOT)) for path in files]
    adapter_path = ROOT / "src" / "tools" / "webmcp.ts"
    adapter_text = adapter_path.read_text(encoding="utf-8") if adapter_path.exists() else ""
    preference_adapter_path = ROOT / "adapters" / "preference_dataset.py"
    preference_adapter_text = (
        preference_adapter_path.read_text(encoding="utf-8")
        if preference_adapter_path.exists()
        else ""
    )
    found_tools = {tool for tool in REQUIRED_TOOLS if tool in combined}
    missing_tools = sorted(REQUIRED_TOOLS - found_tools)

    graph_terms = {term for term in ("nodes", "edges", "flows_to", "targets") if term in combined}
    simulator_present = bool(re.search(r"simulate|cast.*trace|event.*trace", combined, re.I))
    webmcp_present = "modelContext" in combined and "registerTool" in combined
    feature_detection = bool(
        re.search(r"document\.modelContext\??\.registerTool|typeof\s+document\.modelContext", combined)
    )
    standard_annotations = all(
        marker in adapter_text for marker in ("readOnlyHint", "untrustedContentHint")
    ) and "destructiveHint" not in adapter_text
    execution_cancellation = all(
        marker in combined for marker in ("WebMCPExecutionOptions", "signal.aborted", "AbortError")
    )
    response_security = all(
        marker in combined
        for marker in (
            "Content-Security-Policy",
            "Permissions-Policy",
            "Referrer-Policy",
            "X-Content-Type-Options",
        )
    )
    registration_lifecycle = all(
        marker in combined
        for marker in ("new AbortController()", "registration.signal", "registration.abort()")
    )
    typed_editor = all(marker in combined for marker in ("connectRunes", "getValidEdgeTypes", "Typed edge category"))
    advisory_familiar = all(marker in combined for marker in ("inferFamiliar", "authoritative: false", "rounds: 2"))
    constrained_search = all(
        marker in combined
        for marker in ("searchEvidence", "eligibleCandidateCount", "constraintsSatisfied")
    )
    nonmutating_patch_preview = all(
        marker in combined
        for marker in ("previewPatch", "baseGraphVersion", "simulatedGraphVersion", "editorMutated: false")
    )
    bounded_causal_trace = all(
        marker in combined
        for marker in ("MAX_TRACE_DEPTH", "MAX_TRACE_PATHS", "typeViolations", "cycles", "responsibleEdgeIds")
    )
    coherent_filtered_inspection = all(
        marker in combined
        for marker in ("scenarioState", "boundaryEdges", "omittedNodeCount", "internalEdgeCount")
    )
    minimal_side_effect_proof = all(
        marker in combined
        for marker in ("causalSteps", "ruleEvidence", "necessityChecks", "everyResponsibleEdgeNecessary", "no-protective-umbrella-route")
    )
    canonical_patch_review = all(
        marker in combined
        for marker in ("operationLedger", "reviewSummary", "appliedPatch", "revertedPatch", "patch?.operationLedger")
    )
    validated_patch_preconditions = all(
        marker in combined
        for marker in ("expectedGraphVersion", "requiredEdgeIds", "requiredDormantNodeIds", "requiredConstraintIds", "validatedPreconditions")
    )
    proposal_issued_patches = all(
        marker in combined
        for marker in ("issuedPatches", "requireIssuedPatch", "call propose_spell_patch first")
    )
    sacred_reachability = all(
        marker in combined
        for marker in ("Sacred constraint", "no longer reachable from a source")
    )
    deterministic_agent_gym = all(
        marker in combined
        for marker in (
            "hexmend-agent-gym/v1",
            "multi-family-prototype",
            "AGENT_GYM_MAX_SCORE",
            "AGENT_GYM_SPLIT_SIZES",
            "AGENT_GYM_FAMILY_SPLIT_SIZES",
            "AGENT_GYM_FAMILY_IDS",
            "family-01-v1",
            "resonant-feedback-cycle",
            "family-03-v1",
            "unguarded-premature-action",
            "opaque-node-ids",
            "opaque-edge-ids",
            "benign-decoy-subgraph",
            "sampleAgentGymTask",
            "hexmend-agent-gym-sampler/v1",
            "xorshift32-uniform-task-v1",
            "benchmarkAgentGymFamily",
            "hexmend-agent-gym-benchmark/v1",
            "AGENT_GYM_MAX_EPISODE_STEPS",
            "observationBefore",
            "observeSpellGraph",
            "hexmend-public-spell-graph/v1",
            "groundConstraintTarget",
            "stateKeyBefore",
            "terminated",
            "truncated",
            "serializeAgentGymDatasetJsonl",
            "hexmend-agent-gym-episode/v2",
            "initialObservation",
            "initialStateKey",
            "verifyAgentGymDatasetJsonl",
            "hexmend-agent-gym-replay-verifier/v1",
            "hexmend-agent-gym-policy-benchmark/v1",
            "benchmarkAgentGymPolicies",
            "AGENT_GYM_POLICY_BASELINES",
            "hexmend-agent-gym-preference-group/v2",
            "hexmend-agent-gym-preference-verifier/v2",
            "collectAgentGymPreferenceGroups",
            "verifyAgentGymPreferenceGroupsJsonl",
            "hexmend-agent-gym/jsonl-v1",
            "hexmend-tool-manifest/v1",
            "createSpellToolManifest",
            "actionManifest",
            "createAgentGymJsonlBridge",
            "HexmendEnv",
            "HexmendVectorEnv",
            "HexmendPreferenceDataset",
            "hexmend-agent-gym-preference-pair/v2",
            "constraintViolation",
            "constraintPreserved",
            "instrumentSpellToolHandlers",
            "createAgentGymEnvironment",
            "trajectory",
            "rewardDelta",
        )
    ) and all(
        marker in preference_adapter_text
        for marker in (
            "no preference groups match",
            "self.groups(split=split, family=family)",
        )
    ) and (ROOT / "scripts" / "serve-agent-gym.ts").exists() and (ROOT / "scripts" / "verify-agent-gym-dataset.ts").exists() and (ROOT / "scripts" / "export-agent-gym-preferences.ts").exists() and (ROOT / "scripts" / "verify-agent-gym-preferences.ts").exists() and (ROOT / "adapters" / "hexmend_env.py").exists() and preference_adapter_path.exists() and (ROOT / "tests" / "webmcp-multi-scenario.test.mjs").exists()
    tests = [path for path in relative_files if re.search(r"(?:test|spec)\.[cm]?[jt]sx?$", path)]
    scenario_present = "moonflower" in combined.lower() and "duck" in combined.lower()

    return [
        Check("source tree", bool(files), f"{len(files)} JS/TS source files found"),
        Check(
            "typed graph vocabulary",
            len(graph_terms) >= 3,
            f"found terms: {', '.join(sorted(graph_terms)) or 'none'}",
        ),
        Check(
            "deterministic simulator surface",
            simulator_present,
            "simulation/trace symbols detected" if simulator_present else "no simulator/trace surface detected",
        ),
        Check(
            "canonical scenario",
            scenario_present,
            "moonflower and duck fixture detected" if scenario_present else "moonflower/duck fixture not detected",
        ),
        Check(
            "required WebMCP tools",
            not missing_tools,
            "all seven found" if not missing_tools else f"missing: {', '.join(missing_tools)}",
        ),
        Check(
            "WebMCP registration",
            webmcp_present,
            "document.modelContext.registerTool detected" if webmcp_present else "registration not detected",
        ),
        Check(
            "WebMCP feature detection",
            feature_detection,
            "guarded registration detected" if feature_detection else "feature guard not detected",
        ),
        Check(
            "tool safety annotations",
            standard_annotations,
            "current read-only and trusted-output annotations detected" if standard_annotations else "current standard annotations are incomplete or include legacy fields",
        ),
        Check(
            "WebMCP execution cancellation",
            execution_cancellation,
            "pre-cancelled calls fail before handler execution" if execution_cancellation else "execution AbortSignal is not guarded",
        ),
        Check(
            "production response security",
            response_security,
            "CSP, permissions, referrer, and MIME protections detected" if response_security else "worker security headers are incomplete",
        ),
        Check(
            "WebMCP registration lifecycle",
            registration_lifecycle,
            "abort-scoped registration cleanup detected" if registration_lifecycle else "registration cleanup is not lifecycle-scoped",
        ),
        Check(
            "semantic graph editor",
            typed_editor,
            "typed compatibility and validated connection surface detected" if typed_editor else "manual typed-connection surface missing",
        ),
        Check(
            "advisory Familiar boundary",
            advisory_familiar,
            "two-round advisory model is explicitly non-authoritative" if advisory_familiar else "Familiar advisory boundary missing",
        ),
        Check(
            "constraint-ranked graph repair",
            constrained_search,
            "rank, edit cost, eligibility, and satisfied constraints detected" if constrained_search else "bounded repair ranking evidence missing",
        ),
        Check(
            "non-mutating patch simulation",
            nonmutating_patch_preview,
            "current patch IDs return explicit base/simulated version evidence without editor mutation" if nonmutating_patch_preview else "bounded patch-preview simulation evidence missing",
        ),
        Check(
            "bounded causal tracing",
            bounded_causal_trace,
            "ordered paths expose responsible edges, cycles, type violations, and hard bounds" if bounded_causal_trace else "bounded causal-path evidence missing",
        ),
        Check(
            "coherent filtered inspection",
            coherent_filtered_inspection,
            "focused inspections partition internal and boundary edges and include current scenario state" if coherent_filtered_inspection else "coherent filtered inspection evidence missing",
        ),
        Check(
            "minimal side-effect proof",
            minimal_side_effect_proof,
            "typed causal subgraph includes rule premises and counterfactual edge-necessity checks" if minimal_side_effect_proof else "structured minimal side-effect evidence missing",
        ),
        Check(
            "canonical patch review receipt",
            canonical_patch_review,
            "proposal, simulation, application, rollback, and UI share one structured operation ledger" if canonical_patch_review else "shared patch-review receipt missing",
        ),
        Check(
            "validated patch preconditions",
            validated_patch_preconditions,
            "version, live-edge, dormant-rune, and sacred-lock facts are explicit and revalidated before mutation" if validated_patch_preconditions else "explicit structural patch preconditions are missing",
        ),
        Check(
            "proposal-issued patch capabilities",
            proposal_issued_patches,
            "preview and mutation require a patch ID issued for the current graph version" if proposal_issued_patches else "guessable patch IDs can bypass proposal review",
        ),
        Check(
            "sacred reachability invariant",
            sacred_reachability,
            "atomic patches fail closed when sacred reachability is lost" if sacred_reachability else "sacred reachability guard missing",
        ),
        Check(
            "deterministic Agent Gym episode",
            deterministic_agent_gym,
            "shared definitions and handlers expose a self-describing rollout protocol, 96 variants across three causal families, verifier-backed preference groups with filtered streaming Python pairs, replay observations, independently verified JSONL datasets, and isolated vector Python rollouts" if deterministic_agent_gym else "Agent Gym rollout, action manifest, preference groups, Python reader, split families, replay verifier, or shared-handler instrumentation missing",
        ),
        Check("source-level tests", bool(tests), f"{len(tests)} test files found"),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quick",
        action="store_true",
        help="skip the required browser/E2E suite while retaining build and unit gates",
    )
    args = parser.parse_args()

    checks: list[Check] = []
    for required in ("program.md", "train.py", "prepare.py"):
        checks.append(
            Check(
                f"control file {required}",
                (ROOT / required).exists(),
                "present" if (ROOT / required).exists() else "missing",
            )
        )

    for required in (
        "submission/description.md",
        "submission/demo-script.md",
        "submission/architecture.md",
        "submission/acceptance-matrix.md",
        "submission/webmcp-conformance.md",
        "submission/security.md",
        "submission/deployment.md",
        "submission/devpost-entry.md",
        "submission/release-evidence.json",
        "submission/tool-inventory.md",
        "submission/limitations.md",
        "submission/screenshots/README.md",
        "submission/screenshots/capture.mjs",
        "submission/screenshots/01-failure-diagnosis.jpg",
        "submission/screenshots/02-constraint-aware-patch.jpg",
        "submission/screenshots/03-successful-recast.jpg",
        "submission/video/README.md",
        "submission/video/narration.txt",
        "submission/video/captions.srt",
        "submission/video/render-demo.sh",
        "submission/video/metadata.json",
        "submission/video/hexmend-demo.mp4",
        "public/og.png",
        "public/favicon.png",
    ):
        path = ROOT / required
        checks.append(
            Check(
                f"deliverable {required}",
                path.exists() and path.stat().st_size > 0,
                "present" if path.exists() and path.stat().st_size > 0 else "missing or empty",
            )
        )

    for screenshot in (
        "submission/screenshots/01-failure-diagnosis.jpg",
        "submission/screenshots/02-constraint-aware-patch.jpg",
        "submission/screenshots/03-successful-recast.jpg",
    ):
        checks.append(screenshot_capture_check(screenshot))

    checks.append(demo_video_check())
    checks.extend(release_evidence_checks(require_external=not args.quick))

    package, package_check = load_package()
    checks.append(package_check)
    files = source_files()
    combined = source_text(files)
    checks.extend(static_checks(files, combined))

    runner = choose_runner()
    if package:
        checks.append(script_check(package, runner, ["typecheck", "check"], required=True))
        checks.append(script_check(package, runner, ["test", "test:unit"], required=True))
        checks.append(script_check(package, runner, ["build"], required=True, timeout=360))
        checks.append(script_check(package, runner, ["test:deployment"], required=True))
        checks.append(script_check(package, runner, ["test:submission"], required=True))
        checks.append(script_check(package, runner, ["lint"], required=False))
        if not args.quick:
            checks.append(
                script_check(
                    package,
                    runner,
                    ["test:e2e", "e2e", "test:browser"],
                    required=True,
                    timeout=480,
                )
            )
            checks.append(browser_evidence_check(require_site_tools=True))

    print("\nHexmend acceptance report")
    print("=" * 36)
    for check in checks:
        marker = "PASS" if check.passed else "FAIL"
        print(f"[{marker}] {check.name}: {check.detail}")

    failures = [check for check in checks if not check.passed]
    print()
    if failures:
        print(f"Result: FAIL ({len(failures)} acceptance gates unmet)")
        return 1
    print("Result: PASS (all selected acceptance gates met)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
