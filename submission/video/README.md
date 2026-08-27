# Reproducible demo video

`hex-machina-demo.mp4` is the judge-facing 75-second failure → constrained repair → verified success story. It is assembled entirely from the three browser-verified submission captures and a local text-to-speech reading of `narration.txt`; it does not depend on external media services.

## Render

On macOS with FFmpeg installed:

```bash
./submission/video/render-demo.sh
```

The script generates a 1920×1080, 30 fps H.264/AAC MP4, pads the narration track to the exact 75-second runtime, enables fast-start playback, and records probe evidence in `metadata.json`. Override the installed narration voice with `HEX_MACHINA_VOICE` if necessary.

`captions.srt` is a human-edited accessibility sidecar aligned with the sections in `submission/demo-script.md`. Keep it with the MP4 when uploading to any submission platform that accepts caption files.
