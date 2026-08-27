#!/usr/bin/env bash
set -euo pipefail

VIDEO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$VIDEO_DIR/../.." && pwd)"
VIDEO_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hex-machina-video.XXXXXX")"
trap 'rm -rf -- "$VIDEO_TMP_DIR"' EXIT

VOICE="${HEX_MACHINA_VOICE:-Samantha}"
NARRATION="$VIDEO_DIR/narration.txt"
OUTPUT="$VIDEO_DIR/hex-machina-demo.mp4"

command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
command -v say >/dev/null

say -v "$VOICE" -r 145 -f "$NARRATION" -o "$VIDEO_TMP_DIR/narration.aiff"
NARRATION_SECONDS="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO_TMP_DIR/narration.aiff")"
if ! awk -v duration="$NARRATION_SECONDS" 'BEGIN { exit !(duration <= 74) }'; then
  printf 'Narration is %0.1f seconds; shorten it below 74 seconds to preserve the ending.\n' "$NARRATION_SECONDS" >&2
  exit 1
fi

ffmpeg -hide_banner -loglevel warning -y \
  -loop 1 -t 25 -i "$PROJECT_DIR/submission/screenshots/01-failure-diagnosis.jpg" \
  -loop 1 -t 25 -i "$PROJECT_DIR/submission/screenshots/02-constraint-aware-patch.jpg" \
  -loop 1 -t 25 -i "$PROJECT_DIR/submission/screenshots/03-successful-recast.jpg" \
  -i "$VIDEO_TMP_DIR/narration.aiff" \
  -filter_complex \
    "[0:v]scale=1920:1080,setsar=1,format=yuv420p[v0]; \
     [1:v]scale=1920:1080,setsar=1,format=yuv420p[v1]; \
     [2:v]scale=1920:1080,setsar=1,format=yuv420p[v2]; \
     [v0][v1][v2]concat=n=3:v=1:a=0[v]; \
     [3:a]volume=1.0,afade=t=out:st=71.2:d=0.5,apad=whole_dur=75[a]" \
  -map "[v]" -map "[a]" \
  -t 75 -r 30 \
  -c:v libx264 -preset medium -crf 21 -profile:v high -level 4.1 \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  "$OUTPUT"

ffprobe -v error \
  -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate \
  -of json "$OUTPUT" > "$VIDEO_DIR/metadata.json"

printf 'Rendered %s\n' "$OUTPUT"
