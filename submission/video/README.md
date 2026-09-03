# Reproducible demo video

`hexmend-demo.mp4` is the judge-facing 147.9-second failure → constrained repair → verified success story. It is a real browser screencast in which a standing-in WebMCP host drives the registered tools, followed by a held-out task swap that demonstrates fresh opaque identifiers. The audio is a human reading of `narration.txt` (`narration.m4a`); `narration-timeline.json` records where each paragraph starts and ends in it, and both the screencast's pacing and the captions are driven from that file. Rendering does not depend on external media services.

## Render

On macOS with FFmpeg installed:

```bash
./submission/video/render-demo.sh
```

Start the application, then run the renderer with `HEXMEND_DEMO_URL` pointed at that instance. The script records the browser at 1600×900 with every tool call scheduled against the narration timeline, renders a 1920×1080, 30 fps H.264/AAC MP4, enables fast-start playback, and records probe evidence in `metadata.json`. It rejects narration over 165 seconds to preserve headroom beneath the challenge's three-minute cap. To re-record the narration, replace `narration.m4a` and refresh the paragraph times in `narration-timeline.json` (a word-level transcript aligned to `narration.txt` is the quickest way).

Keep `captions.srt` with the MP4 when uploading to any submission platform that accepts caption files.

For the final public upload, use the copy-ready title, description, chapters,
visibility checklist, and safe evidence-recording command in
[`youtube-upload.md`](youtube-upload.md).
