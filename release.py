#!/usr/bin/env python3
"""Release helper: record the public YouTube URL of the demo in the release evidence.

    python3 release.py record-youtube "https://www.youtube.com/watch?v=VIDEO_ID"

The command validates the URL, checks the local video evidence still stands
(audio present, under three minutes, file on disk), and changes only
`video.public_youtube_url` in submission/release-evidence.json. Run
`python3 prepare.py` afterwards to close the final acceptance gate.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RELEASE_EVIDENCE = ROOT / "submission" / "release-evidence.json"
YOUTUBE_URL_PATTERN = re.compile(
    r"https://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)[A-Za-z0-9_-]+(?:[&?][^\s]*)?"
)


def record_youtube_release(evidence_path: Path, url: str) -> None:
    """Record an already-public YouTube upload without changing other evidence."""
    if not YOUTUBE_URL_PATTERN.fullmatch(url):
        raise ValueError("Expected a public YouTube watch or youtu.be URL")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    video = evidence.get("video")
    if not isinstance(video, dict):
        raise ValueError("Release evidence is missing its video record")
    local_path = video.get("local_path")
    if (
        not isinstance(local_path, str)
        or video.get("has_audio") is not True
        or not isinstance(video.get("duration_seconds"), (int, float))
        or not 0 < video["duration_seconds"] < 180
    ):
        raise ValueError("Local video evidence must have audio and remain below three minutes")
    if evidence_path == RELEASE_EVIDENCE and not (ROOT / local_path).is_file():
        raise ValueError("The recorded local video file does not exist")
    video["public_youtube_url"] = url
    temporary = evidence_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    temporary.replace(evidence_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)
    youtube = subparsers.add_parser("record-youtube", help="Record the URL of an already-public YouTube demo")
    youtube.add_argument("url")
    youtube.add_argument("--evidence", type=Path, default=RELEASE_EVIDENCE, help=argparse.SUPPRESS)
    args = parser.parse_args()
    evidence_path = args.evidence.resolve()
    try:
        record_youtube_release(evidence_path, args.url)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Could not record YouTube release: {error}", file=sys.stderr)
        return 2
    displayed = evidence_path.relative_to(ROOT) if evidence_path.is_relative_to(ROOT) else evidence_path
    print(f"Public YouTube URL recorded in {displayed}.")
    print("Next: run python3 prepare.py, then submit the three public URLs to Devpost.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
