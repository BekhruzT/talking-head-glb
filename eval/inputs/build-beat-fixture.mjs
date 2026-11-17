// Builds fake /tts responses from the BEAT corpus so the avatar can replay real
// human blendshape motion with the human's own audio. Per inputs/caseNN clip:
// cut from the first word to the strongest pause near TARGET_SECONDS, denoise
// with DeepFilterNet and encode to mp3, remap the blendshape channels into the
// Azure order the frontend expects, and emit caseNN/fixture.json plus a cases.js
// index (a plain script, not JSON, so compare.html also works opened from disk).
//
// Usage: node eval/inputs/build-beat-fixture.mjs
// Needs ffmpeg on PATH and inputs/deep-filter.exe (DeepFilterNet release binary).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { AZURE_BLENDSHAPE_NAMES, STREAM_FPS } from "../../packages/talking-head/src/avatar/blendshape-stream.ts";
import { CLIPS, caseId, caseDir } from "./download-corpus.mjs";

// BEAT sessions open with 1.5-4s of dead air and end wherever the wall clock
// lands, so a fixed window left every case starting on an idling face and
// stopping mid-word. Start at the first word, end at the longest pause that
// still leaves a reasonable amount of speech.
const TARGET_SECONDS = 12;
const MIN_SECONDS = 6.5;
const LEAD = 0.25; // closed-mouth frames before the first word; also what
// anchors normalizeFrames' rest pose, which is a per-channel minimum
const RELEASE = 0.35; // let the last word's articulation finish

/** Index of the word to end on, and the pause that follows it. */
function phraseEnd(words) {
  const t0 = words[0].start;
  let best = null;
  let fallback = 0;
  for (let k = 0; k < words.length; k++) {
    const len = words[k].end - t0;
    if (len > TARGET_SECONDS) break;
    fallback = k;
    if (len < MIN_SECONDS) continue;
    const next = words[k + 1];
    const gap = next ? next.start - words[k].end : Infinity;
    if (!best || gap > best.gap || (gap === best.gap && len > best.len)) best = { k, gap, len };
  }
  // ponytail: longest silence proxies a phrase boundary but cannot tell a
  // syntactic break from a hesitation, so a speaker pausing after "i" still
  // ends mid-clause (2 of 20 cases). Upgrade path: pin the word index per clip
  // in download-corpus.mjs's SESSIONS.
  return best ?? { k: fallback, gap: 0 };
}

// Raw BEAT/ARKit weights are calibrated for a human face, not this rig: jawOpen
// peaks at ~0.28, which reads as mumbling. Expand the articulators with
// 1-(1-v)^G (monotonic and clip-free, boosting the low-mid range). Emotion
// channels are left alone deliberately -- boosting those brought back the
// grinning problem. ponytail: one global gain rather than per-channel
// calibration; if a single channel looks off, give it its own exponent here.
const ARTICULATION_GAIN = 2.0; // 2.5 read as over-opening on the peaks
const ARTICULATORS = new Set([
  "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker",
  "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "mouthStretchLeft", "mouthStretchRight",
  "mouthRollLower", "mouthRollUpper",
  "mouthShrugLower", "mouthShrugUpper",
]);
const expand = (v) => 1 - Math.pow(1 - Math.min(1, Math.max(0, v)), ARTICULATION_GAIN);

/** Words tier of a TextGrid as [{start, end, word}], silences excluded. */
function parseWords(textgrid) {
  const wordsTier = textgrid.split(/item \[2\]/)[0];
  const words = [];
  const re = /xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "([^"]*)"/g;
  for (const [, xmin, xmax, text] of wordsTier.matchAll(re)) {
    if (text.trim()) words.push({ start: +xmin, end: +xmax, word: text.trim() });
  }
  return words;
}

const cases = [];
CLIPS.forEach((clip, i) => {
  const id = caseId(i);
  const base = join(caseDir(i), clip);

  const words = parseWords(readFileSync(`${base}.TextGrid`, "utf8"));
  const end = phraseEnd(words);
  const spoken = words.slice(0, end.k + 1).map((w) => w.word);
  const from = Math.max(0, words[0].start - LEAD);
  const to = words[end.k].end + RELEASE;
  const seconds = to - from;

  // Cleanup chain: cut span -> 48kHz (DeepFilterNet's rate) -> denoise ->
  // loudness-normalize -> mp3. Kills the room tone / mic artifacts that gave
  // the raw BEAT recordings away as non-synthetic.
  const tmp = join(tmpdir(), "beat-cut.wav");
  const df = join(import.meta.dirname, "deep-filter.exe");
  mkdirSync(join(tmpdir(), "df-clean"), { recursive: true });
  execSync(`ffmpeg -y -v error -ss ${from.toFixed(2)} -t ${seconds.toFixed(2)} -i "${base}.wav" -ar 48000 "${tmp}"`);
  execSync(`"${df}" -D -o "${tmpdir()}\\df-clean" "${tmp}"`);
  execSync(
    `ffmpeg -y -v error -i "${tmpdir()}\\df-clean\\beat-cut.wav" -af loudnorm=I=-18:TP=-2 -ar 44100 -codec:a libmp3lame -b:a 96k "${base}.mp3"`
  );

  const beat = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  const srcFps = 1 / (beat.frames[1].time - beat.frames[0].time);
  const map = AZURE_BLENDSHAPE_NAMES.map((n) => beat.names.indexOf(n));
  const boost = AZURE_BLENDSHAPE_NAMES.map((n) => ARTICULATORS.has(n));
  const srcFrames = beat.frames.slice(Math.round(from * srcFps), Math.round(to * srcFps));
  const frames = [];
  for (let f = 0; f < Math.round(seconds * STREAM_FPS); f++) {
    const pos = (f / STREAM_FPS) * srcFps;
    const i0 = Math.min(Math.floor(pos), srcFrames.length - 1);
    const i1 = Math.min(i0 + 1, srcFrames.length - 1);
    const k = pos - i0;
    const a = srcFrames[i0].weights;
    const b = srcFrames[i1].weights;
    frames.push(map.map((j, c) => {
      if (j < 0) return 0;
      const v = a[j] + (b[j] - a[j]) * k;
      return boost[c] ? expand(v) : v;
    }));
  }

  const text = spoken.join(" ");
  const ticks = Math.round(seconds * 1e7);
  writeFileSync(
    join(caseDir(i), "fixture.json"),
    JSON.stringify({
      audio: readFileSync(`${base}.mp3`).toString("base64"),
      visemes: [
        { audioOffset: 0, audio_position: 0, visemeId: 0, viseme_id: 0 },
        { audioOffset: ticks, audio_position: ticks, visemeId: 0, viseme_id: 0 },
      ],
      blendShapeFrames: frames,
      text,
      emotion: "neutral",
    })
  );
  cases.push({ id, clip, seconds: +seconds.toFixed(2), text });
  console.log(`${id}  ${clip}  ${seconds.toFixed(1)}s  pause ${end.gap.toFixed(2)}s  "...${text.split(" ").slice(-5).join(" ")}"`);
});

writeFileSync(
  join(import.meta.dirname, "cases.js"),
  `// Generated by build-beat-fixture.mjs -- do not edit.\nglobalThis.CASES = ${JSON.stringify(cases, null, 2)};\n`
);
console.log(`wrote ${cases.length} fixtures + cases.js`);
