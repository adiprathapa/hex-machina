#!/usr/bin/env bash
set -euo pipefail

# Renders the demo as a narrated screencast of a browser agent driving the seven
# WebMCP tools. The earlier version concatenated three static screenshots, which
# never showed a tool being called — the entire claim — and the challenge rules
# let judges score a submission from the video alone.
#
# Requires a running instance. Point at it with HEX_MACHINA_DEMO_URL; defaults
# to the local dev server.

VIDEO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$VIDEO_DIR/../.." && pwd)"
VIDEO_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hex-machina-video.XXXXXX")"
trap 'rm -rf -- "$VIDEO_TMP_DIR"' EXIT

VOICE="${HEX_MACHINA_VOICE:-Samantha}"
NARRATION="$VIDEO_DIR/narration.txt"
OUTPUT="$VIDEO_DIR/hex-machina-demo.mp4"
DEMO_URL="${HEX_MACHINA_DEMO_URL:-http://localhost:4321/}"

command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
command -v say >/dev/null

say -v "$VOICE" -r 150 -f "$NARRATION" -o "$VIDEO_TMP_DIR/narration.aiff"
NARRATION_SECONDS="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO_TMP_DIR/narration.aiff")"

# The challenge caps the demo under three minutes; leave headroom for the tail.
if ! awk -v duration="$NARRATION_SECONDS" 'BEGIN { exit !(duration <= 165) }'; then
  printf 'Narration is %0.1f seconds; shorten it below 165 seconds to stay under the cap.\n' "$NARRATION_SECONDS" >&2
  exit 1
fi

DEMO_VIDEO_DIR="$VIDEO_TMP_DIR/screencast"
export DEMO_VIDEO_DIR
mkdir -p "$DEMO_VIDEO_DIR"

( cd "$PROJECT_DIR" && npx tsx "$VIDEO_DIR/record-screencast.mjs" "$DEMO_URL" )
SCREENCAST="$(find "$DEMO_VIDEO_DIR" -name '*.webm' | head -1)"
[ -n "$SCREENCAST" ] || { printf 'No screencast was recorded.\n' >&2; exit 1; }

ffmpeg -hide_banner -loglevel error -y \
  -i "$SCREENCAST" \
  -i "$VIDEO_TMP_DIR/narration.aiff" \
  -filter_complex \
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0c0c0d,setsar=1,format=yuv420p[v]; \
     [1:a]volume=1.0,adelay=1500|1500,apad[a]" \
  -map "[v]" -map "[a]" -shortest -r 30 \
  -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.1 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUTPUT"

ffprobe -v error \
  -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate \
  -of json "$OUTPUT" > "$VIDEO_DIR/metadata.json"

printf 'Rendered %s\n' "$OUTPUT"
