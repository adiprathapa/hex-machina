#!/usr/bin/env bash
set -euo pipefail

# Renders the demo as a screencast of a browser agent driving the seven WebMCP
# tools, under a recorded human narration. The earlier version concatenated three static screenshots, which
# never showed a tool being called — the entire claim — and the challenge rules
# let judges score a submission from the video alone.
#
# Requires a running instance. Point at it with HEXMEND_DEMO_URL; defaults
# to the local dev server.

VIDEO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$VIDEO_DIR/../.." && pwd)"
VIDEO_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hexmend-video.XXXXXX")"
trap 'rm -rf -- "$VIDEO_TMP_DIR"' EXIT

NARRATION_AUDIO="$VIDEO_DIR/narration.m4a"
TIMELINE="$VIDEO_DIR/narration-timeline.json"
OUTPUT="$VIDEO_DIR/hexmend-demo.mp4"
DEMO_URL="${HEXMEND_DEMO_URL:-http://localhost:4321/}"

command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
[ -f "$NARRATION_AUDIO" ] || { printf 'Missing %s\n' "$NARRATION_AUDIO" >&2; exit 1; }
[ -f "$TIMELINE" ] || { printf 'Missing %s\n' "$TIMELINE" >&2; exit 1; }

# The narration is a human recording of narration.txt, normalized to the
# spoken-word loudness target (-18 LUFS, -2 dBTP) since a phone recording sits near -33 dB. narration-timeline.json
# holds where each paragraph starts and ends in it (measured once by aligning a
# word-level transcript to the script), and both the screencast's pacing and the
# captions are driven from that file, so nothing here is timed by hand.
NARRATION_SECONDS="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$NARRATION_AUDIO")"
LEAD_IN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["leadInSeconds"])' "$TIMELINE")"
python3 -c 'import json,sys; t=json.load(open(sys.argv[1])); print(json.dumps([{"text": p["text"], "start": p["start"], "end": p["end"]} for p in t["paragraphs"]]))' "$TIMELINE" > "$VIDEO_TMP_DIR/manifest.json"
LEAD_IN_MS="$(python3 -c 'import sys; print(int(round(float(sys.argv[1]) * 1000)))' "$LEAD_IN")"

# The challenge caps the demo under three minutes; leave headroom for the tail.
if ! awk -v duration="$NARRATION_SECONDS" 'BEGIN { exit !(duration <= 165) }'; then
  printf 'Narration is %0.1f seconds; shorten it below 165 seconds to stay under the cap.\n' "$NARRATION_SECONDS" >&2
  exit 1
fi

DEMO_VIDEO_DIR="$VIDEO_TMP_DIR/screencast"
export DEMO_VIDEO_DIR
mkdir -p "$DEMO_VIDEO_DIR"

( cd "$PROJECT_DIR" && DEMO_TIMELINE="$TIMELINE" npx tsx "$VIDEO_DIR/record-screencast.mjs" "$DEMO_URL" )
SCREENCAST="$(find "$DEMO_VIDEO_DIR" -name '*.webm' | head -1)"
[ -n "$SCREENCAST" ] || { printf 'No screencast was recorded.\n' >&2; exit 1; }

ffmpeg -hide_banner -loglevel error -y \
  -i "$SCREENCAST" \
  -i "$NARRATION_AUDIO" \
  -filter_complex \
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0c0c0d,setsar=1,format=yuv420p[v]; \
     [1:a]aformat=channel_layouts=stereo,loudnorm=I=-18:TP=-2:LRA=11,adelay=${LEAD_IN_MS}|${LEAD_IN_MS},apad[a]" \
  -map "[v]" -map "[a]" -shortest -r 30 \
  -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.1 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUTPUT"

ffprobe -v error \
  -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate \
  -of json "$OUTPUT" > "$VIDEO_DIR/metadata.json"

VIDEO_SECONDS="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT")"
node "$VIDEO_DIR/build-captions.mjs" "$VIDEO_TMP_DIR/manifest.json" "$VIDEO_DIR/captions.srt" "$LEAD_IN" "$VIDEO_SECONDS"

printf 'Rendered %s\n' "$OUTPUT"
