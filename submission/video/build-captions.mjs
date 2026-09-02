// Emits captions.srt from the narration's measured paragraph timings, so the
// captions cannot drift from the audio the way hand-kept ones did. Reads a JSON
// array of {text, start, end} (a recording) or {text, seconds} (synthesis).
import { readFile, writeFile } from "node:fs/promises";

const [manifestPath, outputPath, leadInArg, videoSecondsArg] = process.argv.slice(2);
const leadIn = Number(leadInArg ?? 0);
// The screencast runs on past the last line of narration; the final beat is
// still on screen, so the last cue holds through it rather than leaving the
// tail uncaptioned.
const videoSeconds = Number(videoSecondsArg ?? 0);
const parts = JSON.parse(await readFile(manifestPath, "utf8"));

// narration.txt is a text-to-speech script, so it spells things the way they
// should be *said*. Captions are read, not heard.
const SPOKEN_TO_WRITTEN = [
  [/\bdocument dot modelContext\b/g, "document.modelContext"],
  [/\bninety six\b/g, "96"],
  [/\bmemorised\b/g, "memorized"],
  [/\bconstraint aware\b/g, "constraint-aware"],
  [/\bheld out\b/g, "held-out"],
];
const written = (text) => SPOKEN_TO_WRITTEN.reduce((acc, [from, to]) => acc.replace(from, to), text);

// Two cues per paragraph read better than one long line; split on the sentence
// boundary nearest the middle and divide the measured duration by length.
function split(text) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  if (sentences.length < 2 || text.length < 90) return [text.trim()];
  let best = 1;
  let bestGap = Infinity;
  for (let i = 1; i < sentences.length; i += 1) {
    const head = sentences.slice(0, i).join("").length;
    const gap = Math.abs(head - text.length / 2);
    if (gap < bestGap) { bestGap = gap; best = i; }
  }
  return [sentences.slice(0, best).join("").trim(), sentences.slice(best).join("").trim()]
    .filter(Boolean);
}

function stamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

const cues = [];
let clock = leadIn;
for (const part of parts) {
  // A recorded narration gives each paragraph its own start and end (the
  // pauses between them are the reader's); a synthesized one only a length.
  if (typeof part.start === "number") clock = leadIn + part.start;
  const seconds = typeof part.end === "number" ? part.end - part.start : part.seconds;
  const chunks = split(written(part.text));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
  for (const chunk of chunks) {
    const span = seconds * (chunk.length / total);
    cues.push({ start: clock, end: clock + span, text: chunk.replace(/\s+/g, " ") });
    clock += span;
  }
}

if (videoSeconds > clock && cues.length > 0) {
  cues[cues.length - 1].end = videoSeconds;
}

await writeFile(
  outputPath,
  cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n"),
);
process.stdout.write(`Wrote ${cues.length} cues covering ${(cues.at(-1)?.end ?? 0).toFixed(1)}s\n`);
