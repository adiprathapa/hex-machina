#!/usr/bin/env python3
"""Acceptance harness for Hex Machina.

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
    found_tools = {tool for tool in REQUIRED_TOOLS if tool in combined}
    missing_tools = sorted(REQUIRED_TOOLS - found_tools)

    graph_terms = {term for term in ("nodes", "edges", "flows_to", "targets") if term in combined}
    simulator_present = bool(re.search(r"simulate|cast.*trace|event.*trace", combined, re.I))
    webmcp_present = "modelContext" in combined and "registerTool" in combined
    feature_detection = bool(
        re.search(r"document\.modelContext\??\.registerTool|typeof\s+document\.modelContext", combined)
    )
    read_only_marker = "readOnlyHint" in combined
    typed_editor = all(marker in combined for marker in ("connectRunes", "getValidEdgeTypes", "Typed edge category"))
    advisory_familiar = all(marker in combined for marker in ("inferFamiliar", "authoritative: false", "rounds: 2"))
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
            read_only_marker,
            "readOnlyHint detected" if read_only_marker else "readOnlyHint not detected",
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
        "submission/tool-inventory.md",
        "submission/limitations.md",
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

    print("\nHex Machina acceptance report")
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
