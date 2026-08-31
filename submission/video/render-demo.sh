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

# Synthesize one paragraph at a time and measure each, so the captions can be
# generated from the real audio instead of hand-maintained beside it. They had
# already drifted: six of fourteen paragraphs did not match the shipped cues.
GAP_SECONDS=0.45
: > "$VIDEO_TMP_DIR/concat.txt"
: > "$VIDEO_TMP_DIR/manifest.jsonl"
ffmpeg -hide_banner -loglevel error -y -f lavfi -t "$GAP_SECONDS" -i anullsrc=r=22050:cl=mono "$VIDEO_TMP_DIR/gap.aiff"

PART=0
while IFS= read -r paragraph; do
  [ -n "$paragraph" ] || continue
  PART=$((PART + 1))
  PART_FILE="$VIDEO_TMP_DIR/part-$PART.aiff"
  printf '%s' "$paragraph" | say -v "$VOICE" -r 150 -o "$PART_FILE"
  PART_SECONDS="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$PART_FILE")"
  [ "$PART" -eq 1 ] || printf "file '%s'\n" "$VIDEO_TMP_DIR/gap.aiff" >> "$VIDEO_TMP_DIR/concat.txt"
  printf "file '%s'\n" "$PART_FILE" >> "$VIDEO_TMP_DIR/concat.txt"
  python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "seconds": float(sys.argv[2]) + float(sys.argv[3])}))' \
    "$paragraph" "$PART_SECONDS" "$GAP_SECONDS" >> "$VIDEO_TMP_DIR/manifest.jsonl"
done < <(awk 'BEGIN { RS = ""; ORS = "\n" } { gsub(/\n/, " "); print }' "$NARRATION")

[ "$PART" -gt 0 ] || { printf 'Narration produced no paragraphs.\n' >&2; exit 1; }

ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$VIDEO_TMP_DIR/concat.txt" -c copy "$VIDEO_TMP_DIR/narration.aiff"
NARRATION_SECONDS="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO_TMP_DIR/narration.aiff")"

python3 -c 'import json,sys; print(json.dumps([json.loads(l) for l in open(sys.argv[1]) if l.strip()]))' \
  "$VIDEO_TMP_DIR/manifest.jsonl" > "$VIDEO_TMP_DIR/manifest.json"
node "$VIDEO_DIR/build-captions.mjs" "$VIDEO_TMP_DIR/manifest.json" "$VIDEO_DIR/captions.srt" 1.5

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
