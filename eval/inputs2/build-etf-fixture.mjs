// Builds fake /tts responses from the 3D-ETF corpus, as build-beat-fixture.mjs
// does for BEAT, so the avatar can replay a real human's blendshape capture
// with that human's own audio. Differences from the BEAT build: only clips that
// passed check-sync are used (most of 3D-ETF's HDTF half is not synced well
// enough to be a reference); each clip's measured A/V offset is subtracted,
// since the tracker can sit ~200ms off its own audio but steadily, so it is a
// shift not a defect; and cuts are transcribed, because 3D-ETF ships wav + npy
// with no transcripts and the generation column needs text to speak.
//
// Usage: node eval/inputs2/build-etf-fixture.mjs
// Needs ffmpeg on PATH, raw/ populated (extract-3detf.ps1 -All), screen.json
// (check-sync.mjs), and SPEECH_KEY/SPEECH_REGION in the repo-root .env.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { AZURE_BLENDSHAPE_NAMES, STREAM_FPS } from "../../packages/talking-head/src/avatar/blendshape-stream.ts";
import { ARKIT, RAW, envelope, readNpy, readWav, silenceMask } from "./check-sync.mjs";

const TARGET_SECONDS = 12;
const MIN_SECONDS = 8;
const LEAD = 0.25;    // closed-mouth frames before the first word; also what
                      // anchors normalizeFrames' rest pose (a per-channel min)
const RELEASE = 0.35; // let the last word's articulation finish
const WANTED = 10;    // cases to emit
const PER_SPEAKER = 2;

// BEAT needed ARTICULATION_GAIN 2.0 because its jawOpen peaked at 0.28 and read
// as mumbling. 3D-ETF peaks at 0.46-0.70 raw, already where BEAT landed *after*
// boosting, so no expansion here. ponytail: if a case reads flat this is the
// knob, same shape as build-beat-fixture's `expand`. The clamp is load-bearing
// beyond the gain curve -- the tracker overshoots ARKit's [0,1] (seen -0.08 and
// 1.11), and a negative minimum would become normalizeFrames' rest pose and
// lift that channel for the whole utterance.
const ARTICULATION_GAIN = 1.0;
const expand = (v) => {
  const c = Math.min(1, Math.max(0, v));
  return ARTICULATION_GAIN === 1 ? c : 1 - (1 - c) ** ARTICULATION_GAIN;
};

const env2 = Object.fromEntries(
  readFileSync(join(import.meta.dirname, "../../.env"), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
// Azure rather than Whisper: the same speech credentials the pipeline already
// uses, and these wavs are already the 16kHz mono PCM its REST endpoint wants.
const KEY = process.env.SPEECH_KEY ?? env2.SPEECH_KEY;
const REGION = process.env.SPEECH_REGION ?? env2.SPEECH_REGION;
if (!KEY || !REGION) throw new Error("SPEECH_KEY / SPEECH_REGION missing from env and .env");

/** Speaker id, so one voice cannot take over the corpus. */
const speaker = (name) => name.replace(/^(WRA|WDA|RD)_/, "").replace(/\d*_\d+$/, "");

/**
 * A speech span bounded by real pauses: starts when speech resumes at or after
 * `afterSec`, ends at the pause nearest TARGET_SECONDS later. Same intent as
 * build-beat-fixture's phraseEnd, but driven by the audio envelope because
 * 3D-ETF has no word alignments to read.
 */
function findWindow(mask, fps, afterSec) {
  const runs = []; // [start, end] frame indices of each silence
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const s = i;
    while (i < mask.length && mask[i]) i++;
    runs.push([s, i]);
  }
  const after = afterSec * fps;
  const onset = runs.find((r) => r[1] >= after)?.[1] ?? Math.round(after);
  if (onset >= mask.length - MIN_SECONDS * fps) return null;

  let best = null;
  for (const [s] of runs) {
    const len = (s - onset) / fps;
    if (len < MIN_SECONDS) continue;
    if (len > TARGET_SECONDS + 3) break;
    const score = Math.abs(len - TARGET_SECONDS);
    if (!best || score < best.score) best = { end: s, score, len };
  }
  if (!best) return null;
  return { from: Math.max(0, onset / fps - LEAD), to: best.end / fps + RELEASE };
}

/** Azure short-audio STT; fine here because every cut is well under its 60s cap. */
async function transcribe(wavCut) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(
      `https://${REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": KEY,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          Accept: "application/json",
        },
        body: readFileSync(wavCut),
      }
    );
    const body = res.ok ? await res.json() : null;
    if (body?.RecognitionStatus === "Success") return body.DisplayText.trim();
    if (attempt >= 4) throw new Error(`stt ${res.status}: ${body ? JSON.stringify(body) : await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

// Pick clips: passing ones first, best correlation first, capped per speaker so
// the corpus is not four cases of the same voice.
const screen = JSON.parse(readFileSync(join(import.meta.dirname, "screen.json"), "utf8"));
const pool = screen.filter((r) => r.pass).sort((a, b) => b.rbest - a.rbest);
const used = {};
const picks = [];
for (let round = 0; round < PER_SPEAKER && picks.length < WANTED; round++) {
  for (const clip of pool) {
    if (picks.length >= WANTED) break;
    const sp = speaker(clip.name);
    if ((used[sp] ?? 0) > round) continue;
    used[sp] = (used[sp] ?? 0) + 1;
    picks.push({ clip, round });
  }
}
if (!picks.length) throw new Error("no clips passed the screen -- run check-sync.mjs first");

const cases = [];
for (let i = 0; i < picks.length; i++) {
  const { clip, round } = picks[i];
  const id = `etf${String(i + 1).padStart(2, "0")}`;
  const dir = join(import.meta.dirname, id);
  mkdirSync(dir, { recursive: true });

  const wavPath = join(RAW, `${clip.name}.wav`);
  const bs = readNpy(join(RAW, `${clip.name}.npy`));
  const wav = readWav(wavPath);
  const fps = bs.rows / wav.seconds;
  const mask = silenceMask(envelope(wav, bs.rows, fps), fps);

  // Later rounds start further in, so the same clip yields a different phrase.
  const win = findWindow(mask, fps, 5 + round * (wav.seconds / (PER_SPEAKER + 1)));
  if (!win) { console.log(`${id}  ${clip.name}  SKIP (no clean window)`); continue; }
  const seconds = win.to - win.from;

  const cut = `-ss ${win.from.toFixed(2)} -t ${seconds.toFixed(2)} -i "${wavPath}"`;
  const mp3 = join(dir, `${clip.name}.mp3`);
  execSync(`ffmpeg -y -v error ${cut} -af loudnorm=I=-18:TP=-2 -ar 44100 -codec:a libmp3lame -b:a 96k "${mp3}"`);
  const wavCut = join(tmpdir(), "etf-stt.wav");
  execSync(`ffmpeg -y -v error ${cut} -ar 16000 -ac 1 -c:a pcm_s16le "${wavCut}"`);

  // Face frames matching this audio span. check-sync defines r as peaking where
  // face[i+lag] tracks env[i], so the frames belonging to audio frame i start
  // lag frames along -- which is what undoes the clip's A/V offset.
  const shift = Math.round((clip.lagMs / 1000) * fps);
  const map = AZURE_BLENDSHAPE_NAMES.map((n) => ARKIT.indexOf(n));
  const a0 = Math.round(win.from * fps) + shift;
  const frames = [];
  for (let f = 0; f < Math.round(seconds * STREAM_FPS); f++) {
    const pos = a0 + (f / STREAM_FPS) * fps;
    const i0 = Math.min(Math.max(0, Math.floor(pos)), bs.rows - 1);
    const i1 = Math.min(i0 + 1, bs.rows - 1);
    const k = pos - Math.floor(pos);
    const x = bs.frames[i0], y = bs.frames[i1];
    frames.push(map.map((j) => (j < 0 ? 0 : expand(x[j] + (y[j] - x[j]) * k))));
  }

  const text = await transcribe(wavCut);
  const ticks = Math.round(seconds * 1e7);
  writeFileSync(
    join(dir, "fixture.json"),
    JSON.stringify({
      audio: readFileSync(mp3).toString("base64"),
      visemes: [
        { audioOffset: 0, audio_position: 0, visemeId: 0, viseme_id: 0 },
        { audioOffset: ticks, audio_position: ticks, visemeId: 0, viseme_id: 0 },
      ],
      blendShapeFrames: frames,
      text,
      emotion: "neutral",
    })
  );

  const jawCol = AZURE_BLENDSHAPE_NAMES.indexOf("jawOpen");
  const jawPeak = Math.max(...frames.map((f) => f[jawCol]));
  cases.push({ id, clip: clip.name, seconds: +seconds.toFixed(2), text });
  console.log(
    `${id}  ${clip.name.padEnd(26)} ${seconds.toFixed(1)}s  r=${clip.rbest.toFixed(2)} ` +
    `shift ${clip.lagMs.toFixed(0)}ms  jawPk ${jawPeak.toFixed(2)}  "${text.slice(0, 48)}..."`
  );
}

writeFileSync(
  join(import.meta.dirname, "cases.js"),
  `// Generated by build-etf-fixture.mjs -- do not edit.\nglobalThis.CASES = ${JSON.stringify(cases, null, 2)};\n`
);
console.log(`\nwrote ${cases.length} fixtures + cases.js`);
console.log(`view: http://localhost:4100/compare.html?corpus=inputs2`);
