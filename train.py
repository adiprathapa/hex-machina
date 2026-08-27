#!/usr/bin/env python3
"""Resumable work driver for the seven-day Hex Machina build.

This does not implement the game or pretend to be an autonomous coding agent.
It preserves durable milestone state between scheduled Codex continuations and
provides a consistent entry point for status, notes, verification, and handoff.
The product contract lives in program.md; prepare.py owns acceptance checks.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
PROGRAM = ROOT / "program.md"
PREPARE = ROOT / "prepare.py"
STATE_DIR = ROOT / "work"
STATE_FILE = STATE_DIR / "hex_machina_state.json"

MILESTONES = [
    ("skeleton", "Application skeleton and graph contracts"),
    ("simulation", "Deterministic spell execution and failure trace"),
    ("repair", "Diagnosis, sacred constraints, and patch search"),
    ("webmcp", "Seven semantic tools and browser registration"),
    ("experience", "Polished interaction, animation, and accessibility"),
    ("hardening", "Regression hardening and optional Familiar experiment"),
    ("submission", "Deployment and submission package"),
]

VALID_STATUSES = {"pending", "in_progress", "complete", "blocked"}


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def initial_state() -> dict[str, Any]:
    return {
        "project": "Hex Machina",
        "schema_version": 1,
        "created_at": now(),
        "updated_at": now(),
        "active_milestone": "skeleton",
        "milestones": {
            key: {"title": title, "status": "pending", "evidence": []}
            for key, title in MILESTONES
        },
        "notes": [
            {
                "at": now(),
                "text": "Seven-day program initialized; implementation not yet scaffolded.",
            }
        ],
        "last_verification": None,
    }


def validate_state(state: dict[str, Any]) -> None:
    if state.get("schema_version") != 1:
        raise ValueError("Unsupported state schema")
    milestones = state.get("milestones")
    if not isinstance(milestones, dict):
        raise ValueError("State is missing milestones")
    expected = {key for key, _ in MILESTONES}
    if set(milestones) != expected:
        raise ValueError("State milestone keys do not match train.py")
    for key, item in milestones.items():
        if item.get("status") not in VALID_STATUSES:
            raise ValueError(f"Invalid status for {key}: {item.get('status')}")


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        state = initial_state()
        save_state(state)
        return state
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    validate_state(state)
    return state


def save_state(state: dict[str, Any]) -> None:
    validate_state(state)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = now()
    temporary = STATE_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    temporary.replace(STATE_FILE)


def next_unfinished(state: dict[str, Any]) -> str | None:
    for key, _ in MILESTONES:
        if state["milestones"][key]["status"] != "complete":
            return key
    return None


def command_status(state: dict[str, Any]) -> int:
    print("Hex Machina build status")
    print(f"Updated: {state['updated_at']}")
    print()
    for key, _ in MILESTONES:
        item = state["milestones"][key]
        marker = {
            "pending": "○",
            "in_progress": "◐",
            "complete": "●",
            "blocked": "!",
        }[item["status"]]
        print(f"{marker} {key:12} {item['status']:11} {item['title']}")
    candidate = next_unfinished(state)
    print()
    print(f"Next unfinished milestone: {candidate or 'none — acceptance verification only'}")
    if state.get("last_verification"):
        check = state["last_verification"]
        print(
            "Last verification: "
            f"{check['result']} at {check['at']} ({check['mode']})"
        )
    if state.get("notes"):
        print("Recent notes:")
        for entry in state["notes"][-5:]:
            print(f"- {entry['at']}: {entry['text']}")
    return 0


def command_set(
    state: dict[str, Any], milestone: str, status: str, evidence: str | None
) -> int:
    if milestone not in state["milestones"]:
        print(f"Unknown milestone: {milestone}", file=sys.stderr)
        return 2
    if status not in VALID_STATUSES:
        print(f"Invalid status: {status}", file=sys.stderr)
        return 2
    item = state["milestones"][milestone]
    item["status"] = status
    if evidence:
        item["evidence"].append({"at": now(), "text": evidence})
    state["active_milestone"] = next_unfinished(state)
    save_state(state)
    print(f"{milestone} -> {status}")
    return 0


def command_note(state: dict[str, Any], text: str) -> int:
    state["notes"].append({"at": now(), "text": text})
    state["notes"] = state["notes"][-100:]
    save_state(state)
    print("Progress note recorded.")
    return 0


def command_verify(state: dict[str, Any], quick: bool) -> int:
    command = [sys.executable, str(PREPARE)]
    if quick:
        command.append("--quick")
    result = subprocess.run(command, cwd=ROOT, check=False)
    state["last_verification"] = {
        "at": now(),
        "mode": "quick" if quick else "full",
        "result": "pass" if result.returncode == 0 else "fail",
        "exit_code": result.returncode,
    }
    save_state(state)
    return result.returncode


def command_context(state: dict[str, Any]) -> int:
    candidate = next_unfinished(state)
    print(PROGRAM.read_text(encoding="utf-8"))
    print("\n--- DURABLE STATE ---")
    print(json.dumps(state, indent=2))
    print("\n--- NEXT ACTION ---")
    if candidate:
        print(
            f"Advance milestone '{candidate}': "
            f"{state['milestones'][candidate]['title']}"
        )
    else:
        print("Run full acceptance, production verification, and submission checks.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("init", help="Create durable state if missing")
    subparsers.add_parser("status", help="Show milestone and verification state")
    subparsers.add_parser("context", help="Print the program and current state")

    set_parser = subparsers.add_parser("set", help="Set milestone status")
    set_parser.add_argument("milestone", choices=[key for key, _ in MILESTONES])
    set_parser.add_argument("status", choices=sorted(VALID_STATUSES))
    set_parser.add_argument("--evidence")

    note_parser = subparsers.add_parser("note", help="Append a progress note")
    note_parser.add_argument("text")

    verify_parser = subparsers.add_parser("verify", help="Run prepare.py")
    verify_parser.add_argument("--quick", action="store_true")
    return parser


def main() -> int:
    if not PROGRAM.exists() or not PREPARE.exists():
        print("program.md and prepare.py must exist beside train.py", file=sys.stderr)
        return 2
    args = build_parser().parse_args()
    state = load_state()
    if args.command == "init":
        print(f"State ready: {STATE_FILE.relative_to(ROOT)}")
        return 0
    if args.command == "status":
        return command_status(state)
    if args.command == "context":
        return command_context(state)
    if args.command == "set":
        return command_set(state, args.milestone, args.status, args.evidence)
    if args.command == "note":
        return command_note(state, args.text)
    if args.command == "verify":
        return command_verify(state, args.quick)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
