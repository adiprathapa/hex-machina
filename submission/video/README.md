# Reproducible demo video

`hex-machina-demo.mp4` is the judge-facing 157.4-second failure → constrained repair → verified success story. It is a real browser screencast in which a standing-in WebMCP host drives the registered tools, followed by a held-out task swap that demonstrates fresh opaque identifiers. A local text-to-speech reading of `narration.txt` supplies the audio; rendering does not depend on external media services.

## Render

On macOS with FFmpeg installed:

```bash
./submission/video/render-demo.sh
```

Start the application, then run the renderer with `HEX_MACHINA_DEMO_URL` pointed at that instance. The script records the browser at 1600×900, renders a 1920×1080, 30 fps H.264/AAC MP4, enables fast-start playback, and records probe evidence in `metadata.json`. It rejects narration over 165 seconds to preserve headroom beneath the challenge's three-minute cap. Override the installed narration voice with `HEX_MACHINA_VOICE` if necessary.

`submission/demo-script.md` remains the concise 75-second storyboard requested by the internal project brief; the final screencast is longer because it shows real tool execution and a second held-out family. Keep `captions.srt` with the MP4 when uploading to any submission platform that accepts caption files.

For the final public upload, use the copy-ready title, description, chapters,
visibility checklist, and safe evidence-recording command in
[`youtube-upload.md`](youtube-upload.md).
