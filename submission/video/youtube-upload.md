# YouTube release handoff

This sheet is the final manual handoff for the already-rendered demo. It does
not authorize an automated upload. The official challenge rules require a
publicly visible YouTube demonstration with audio that shows the functioning
project and explains its WebMCP use; the video must be less than three minutes.

## Upload settings

- File: `submission/video/hex-machina-demo.mp4`
- Visibility: **Public (not Unlisted)**
- Duration: 154.4 seconds (under the three-minute limit)
- Resolution: 1920×1080
- Audio: AAC narration is present
- Captions: upload `submission/video/captions.srt` as English subtitles
- Rights check: original application footage and narration; no third-party music

Wait for HD processing to finish, then play the public URL in a signed-out
window and confirm that picture, narration, and captions work before recording
the link.

## Title

```text
Hex Machina — A WebMCP Agent Gym for Constraint-Preserving Repairs
```

## Description

```text
Hex Machina is an agent-evaluation environment disguised as a graph-native spell game. A browser agent uses seven WebMCP tools to inspect, cast, trace, explain, constrain, simulate, and atomically repair the same executable graph a person sees.

The key moment: the human says “the ducks are funny, they stay.” That subjective preference becomes an executable constraint, making the cheapest destructive repair ineligible. The agent instead proves and applies an umbrella route that preserves all twelve ducks, keeps the room dry, and waters the moonflower.

Live app: https://hex-machina.hex-machina.workers.dev
Source (MIT): https://github.com/adiprathapa/hex-machina

00:00 WebMCP premise and registered tools
00:23 Initial graph inspection and failed cast
00:35 Bounded causal trace and minimal explanation
00:57 Human constraint changes the eligible repair
01:22 Reviewable eight-edit patch ledger
01:34 Safe simulation and atomic application
01:43 Verified recast: ducks preserved, room dry
01:56 Agent Gym: 96 tasks across three causal rules
02:08 Held-out task with freshly remapped identifiers
02:30 Closing thesis

Built for The WebMCP Challenge.
```

## Record the public URL

After the signed-out playback check succeeds, run:

```bash
python3 train.py record-youtube "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID"
python3 prepare.py
```

The first command validates the URL and changes only
`video.public_youtube_url` in `submission/release-evidence.json`. The second
command should close the final external acceptance gate. Commit and push that
evidence change before copying the live URL, repository URL, and YouTube URL
into Devpost.
