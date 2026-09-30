// Searches for a timing metric that separates good lip-sync from bad, and
// proves it by scoring deliberate wrong answers alongside the real pairs.
// Nothing ships until the control table shows daylight between them.
//
// Two changes from the metric in compare.html. It reads the source blendshape
// streams rather than mouth-box luminance, because the pixel proxy tracks its
// own audio at only r=0.44 (reference) / 0.35 (generation), capping any
// cross-column comparison. And alignment comes from word boundaries rather than
// warping one audio envelope onto the other: a fitted warp gives a wrong
// sentence partial credit, since forcing the envelopes together drags the mouth
// curves with them. Word onsets are ground truth on both sides -- exact from
// Azure, recognised for the human recording -- so a wrong sentence scores near
// zero, which is the point.
//
// Usage: node eval/metric-probe.mjs        (backend on :4000, ffmpeg on PATH)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const HERE = import.meta.dirname;
const CASES = ["etf01", "etf02", "etf03", "etf04", "etf05", "etf06", "etf07", "etf08", "etf09", "etf10"];
const FPS = 60;
const MIN_ANCHORS = 3;
// Wide enough that the search never returns its own boundary. At 150ms the
// worst case sat on the clamp, which reads as a measurement but is really the
// search giving up.
const MAX_LAG_MS = 300;
const CACHE = join(HERE, ".probe-cache");
const SCAN = process.argv.includes("--scan");
const NAMES = [
  "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
  "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
  "jawForward", "jawLeft", "jawRight", "jawOpen",
  "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "noseSneerLeft", "noseSneerRight", "tongueOut",
];

const env = Object.fromEntries(
  readFileSync(join(HERE, "../.env"), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const KEY = process.env.SPEECH_KEY ?? env.SPEECH_KEY;
const REGION = process.env.SPEECH_REGION ?? env.SPEECH_REGION;

const sdkPath = createRequire(join(HERE, "../backend/package.json"))
  .resolve("microsoft-cognitiveservices-speech-sdk");
const sdk = (await import(`file://${sdkPath}`)).default ?? (await import(`file://${sdkPath}`));

/* ---------------------------------------------------------------- word times */

/**
 * Word onsets for the human recording. The synthesiser hands its own onsets
 * over for free; the recording has to be recognised, so these carry whatever
 * error the recogniser has -- tens of milliseconds, well under the differences
 * the metric needs to see.
 */
async function referenceWords(mp3Base64, id) {
  const cached = join(CACHE, `${id}.words.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));

  const mp3 = join(tmpdir(), `probe-${id}.mp3`);
  const wav = join(tmpdir(), `probe-${id}.wav`);
  writeFileSync(mp3, Buffer.from(mp3Base64, "base64"));
  execSync(`ffmpeg -y -v error -i "${mp3}" -ar 16000 -ac 1 -c:a pcm_s16le "${wav}"`);

  const speechConfig = sdk.SpeechConfig.fromSubscription(KEY, REGION);
  speechConfig.speechRecognitionLanguage = "en-US";
  speechConfig.outputFormat = sdk.OutputFormat.Detailed;
  speechConfig.requestWordLevelTimestamps();
  const recognizer = new sdk.SpeechRecognizer(
    speechConfig,
    sdk.AudioConfig.fromWavFileInput(readFileSync(wav))
  );

  // Continuous rather than recognizeOnce: these cuts run past the ~15s the
  // single-shot call segments at, and a truncated tail would silently cost
  // anchors at exactly the end where drift is largest.
  const words = [];
  await new Promise((resolve, reject) => {
    recognizer.recognized = (_s, e) => {
      if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
      for (const w of JSON.parse(e.result.json).NBest?.[0]?.Words ?? []) {
        words.push({ text: w.Word, offset: w.Offset, duration: w.Duration });
      }
    };
    // Running off a file, the end of that file arrives as a cancellation with
    // reason EndOfStream. That is the normal finish, not a failure.
    recognizer.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) reject(new Error(`stt: ${e.errorDetails}`));
    };
    recognizer.sessionStopped = () => resolve();
    recognizer.startContinuousRecognitionAsync(() => {}, reject);
  });
  recognizer.close();

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, JSON.stringify(words));
  return words;
}

async function generation(text, id, emotion = "neutral") {
  const cached = join(CACHE, `${id}.${emotion}.gen.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const res = await fetch("http://localhost:4000/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, emotion }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`);
  const { blendShapeFrames, words } = await res.json();
  if (!words?.length) throw new Error("no word boundaries -- restart the backend");
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, JSON.stringify({ blendShapeFrames, words }));
  return { blendShapeFrames, words };
}

/* ------------------------------------------------------------------ anchors */

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

/**
 * Longest common subsequence over normalised word text. Matching by position
 * would not survive the places the two sides genuinely disagree: the fixture
 * text says "3000", which the synthesiser emits as one token and the recogniser
 * hears as "three thousand", and every such spot would shift all later words by
 * one and poison the map. Order-preserving matching just drops those and keeps
 * the anchors on either side.
 */
function matchWords(refWords, genWords) {
  const a = refWords.map((w) => norm(w.text));
  const b = genWords.map((w) => norm(w.text));
  const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) pairs.push([i, j]), i++, j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const TICK = 1e7;

/**
 * Piecewise-linear reference-time -> generation-time map through the matched
 * words, using each word's start and end. Non-monotone anchors are dropped:
 * a recogniser slip can put one word out of order, and a map that goes
 * backwards would resample the generation curve into nonsense.
 */
function timeMap(refWords, genWords, pairs) {
  const anchors = [];
  for (const [i, j] of pairs) {
    anchors.push([refWords[i].offset / TICK, genWords[j].offset / TICK]);
    anchors.push([
      (refWords[i].offset + refWords[i].duration) / TICK,
      (genWords[j].offset + genWords[j].duration) / TICK,
    ]);
  }
  const kept = [];
  for (const p of anchors) {
    const last = kept[kept.length - 1];
    if (!last || (p[0] > last[0] && p[1] > last[1])) kept.push(p);
  }
  return kept;
}

function mapTime(anchors, t) {
  if (t <= anchors[0][0]) return anchors[0][1] + (t - anchors[0][0]);
  const last = anchors[anchors.length - 1];
  if (t >= last[0]) return last[1] + (t - last[0]);
  let lo = 0;
  while (lo < anchors.length - 2 && anchors[lo + 1][0] < t) lo++;
  const [r0, g0] = anchors[lo], [r1, g1] = anchors[lo + 1];
  return g0 + ((t - r0) / (r1 - r0)) * (g1 - g0);
}

/* ------------------------------------------------------------------ signals */

const channel = (frames, col) => frames.map((f) => f[col] ?? 0);

function sampleAt(curve, seconds) {
  const pos = seconds * FPS;
  if (pos <= 0) return curve[0] ?? 0;
  if (pos >= curve.length - 1) return curve[curve.length - 1] ?? 0;
  const i = Math.floor(pos), k = pos - i;
  return curve[i] + (curve[i + 1] - curve[i]) * k;
}

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 8) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) sx += x[i], sy += y[i];
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/* ------------------------------------------------------------------ metrics */

/**
 * How much of the reference's mouth motion the generation reproduces once the
 * two are put on a common word clock. Aligned correlation, so it answers "does
 * the mouth do the same thing at the same point in the sentence" and not "is it
 * equally lively" -- amplitude is expressiveness, which is scored separately.
 */
function alignedCorrelation(ref, gen, anchors, filt = (v) => v) {
  if (anchors.length < MIN_ANCHORS * 2) return null;
  const from = anchors[0][0], to = anchors[anchors.length - 1][0];
  const x = [], y = [];
  for (let t = from; t <= to; t += 1 / FPS) {
    x.push(sampleAt(ref, t));
    y.push(sampleAt(gen, mapTime(anchors, t)));
  }
  return pearson(filt(x), filt(y));
}

const boxcar = (v, w) =>
  v.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -w; k <= w; k++) if (v[i + k] !== undefined) s += v[i + k], n++;
    return s / n;
  });

/**
 * Speech articulation sits around 2-8Hz. Below that is head pose and tracker
 * drift leaking into the coefficients, above it is per-frame jitter; over a
 * 12-second clip the slow end dominates a plain correlation, so both ends are
 * worth removing before comparing.
 */
const FILTERS = {
  raw: (v) => v,
  "smooth 50ms": (v) => boxcar(v, 1),
  "smooth 100ms": (v) => boxcar(v, 3),
  "highpass 1s": (v) => v.map((x, i) => x - boxcar(v, 30)[i]),
  "band 3-30": (v) => { const a = boxcar(v, 1), b = boxcar(v, 15); return a.map((x, i) => x - b[i]); },
  "band 3-60": (v) => { const a = boxcar(v, 1), b = boxcar(v, 30); return a.map((x, i) => x - b[i]); },
  velocity: (v) => v.slice(1).map((x, i) => x - v[i]),
};

/**
 * Whatever shift is still left after the words line up, in milliseconds.
 * Negative means the generation's mouth leads its own words. Word anchors put
 * the two on the same clock, so anything remaining is the pipeline moving the
 * mouth early or late *within* the words -- the one part of timing error that
 * survives alignment, and the part a viewer reads as being out of sync.
 */
function residualLagMs(refFrames, genFrames, anchors, cols, filt) {
  const maxShift = Math.round((MAX_LAG_MS / 1000) * FPS);
  let best = 0, bestR = -2;
  for (let sh = -maxShift; sh <= maxShift; sh++) {
    const shifted = anchors.map(([r, g]) => [r, g + sh / FPS]);
    const r = multiScore(refFrames, genFrames, shifted, cols, filt);
    if (r > bestR) bestR = r, best = sh;
  }
  return { lagMs: Math.round((best / FPS) * 1000), rAtBest: bestR };
}

/* --------------------------------------------------------------------- main */

const data = {};
for (const id of CASES) {
  const fixture = JSON.parse(readFileSync(join(HERE, "inputs2", id, "fixture.json"), "utf8"));
  const refWords = await referenceWords(fixture.audio, id);
  const gen = await generation(fixture.text, id);
  data[id] = {
    text: fixture.text,
    refWords,
    genWords: gen.words,
    refFrames: fixture.blendShapeFrames,
    genFrames: gen.blendShapeFrames,
  };
  if (!SCAN) console.log(`${id}  ref ${refWords.length}w/${(fixture.blendShapeFrames.length / FPS).toFixed(1)}s   gen ${gen.words.length}w/${(gen.blendShapeFrames.length / FPS).toFixed(1)}s`);
}

/**
 * Which blendshape channels survive the trip between two different solvers.
 * 3D-ETF's coefficients come from a tracker fitted to video, Azure's from a
 * speech model; they share a channel *name* but nothing guarantees they mean
 * the same motion. Only channels that score high on real pairs and near zero on
 * mismatched ones are carrying phonetic content rather than solver habit.
 */
if (SCAN) {
  const rows = [];
  for (let col = 0; col < 52; col++) {
    const hit = [], miss = [];
    for (let i = 0; i < CASES.length; i++) {
      const A = data[CASES[i]], B = data[CASES[(i + 3) % CASES.length]];
      const own = matchWords(A.refWords, A.genWords);
      if (own.length >= MIN_ANCHORS) {
        hit.push(alignedCorrelation(channel(A.refFrames, col), channel(A.genFrames, col),
          timeMap(A.refWords, A.genWords, own)) ?? 0);
      }
      const cross = matchWords(A.refWords, B.genWords);
      if (cross.length >= MIN_ANCHORS) {
        miss.push(alignedCorrelation(channel(A.refFrames, col), channel(B.genFrames, col),
          timeMap(A.refWords, B.genWords, cross)) ?? 0);
      }
    }
    const m = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    rows.push({ col, name: NAMES[col], hit: m(hit), miss: m(miss), gap: m(hit) - m(miss) });
  }
  rows.sort((a, b) => b.gap - a.gap);
  console.log("channel                  correct  mismatched   gap");
  for (const r of rows.slice(0, 18)) {
    console.log(`${String(r.col).padStart(2)} ${r.name.padEnd(22)} ${r.hit.toFixed(3).padStart(6)}  ${r.miss.toFixed(3).padStart(9)}  ${r.gap.toFixed(3).padStart(6)}`);
  }
  process.exit(0);
}

/**
 * Aligned correlation averaged over a set of channels. Pearson already
 * normalises each channel, so this weights every articulator equally rather
 * than letting whichever one happens to swing widest dominate.
 */
function multiScore(refFrames, genFrames, anchors, cols, filt) {
  const rs = cols.map((c) =>
    alignedCorrelation(channel(refFrames, c), channel(genFrames, c), anchors, filt) ?? 0
  );
  return rs.reduce((s, v) => s + v, 0) / rs.length;
}

/**
 * What a *correct* answer can realistically score. The same words synthesised
 * in a different style is two renderings of identical content by the same
 * engine, differing only in performance -- so it is roughly the best a metric
 * that ignores performance should ever see across two sources. Without it,
 * 0.37 for human-vs-Azure is a number with nothing to sit against.
 */
if (process.argv.includes("--ceiling")) {
  const cols = [20, 34, 38, 18];
  const filt = FILTERS["smooth 100ms"];
  const pairs = [];
  for (const id of CASES) {
    const alt = await generation(data[id].text, id, "excited");
    const p = matchWords(
      data[id].genWords.map((w) => ({ ...w })),
      alt.words
    );
    if (p.length < MIN_ANCHORS) { console.log(`${id}  too few anchors`); continue; }
    const r = multiScore(data[id].genFrames, alt.blendShapeFrames,
      timeMap(data[id].genWords, alt.words, p), cols, filt);
    pairs.push(r);
    console.log(`${id}  neutral vs excited  r=${r.toFixed(3)}  (${p.length} anchors)`);
  }
  const mean = pairs.reduce((s, v) => s + v, 0) / pairs.length;
  console.log(`\nsame-content ceiling ${mean.toFixed(3)}   measured human-vs-Azure 0.366`);
  console.log(`Azure reproduces ${((0.366 / mean) * 100).toFixed(0)}% of what a same-content pair scores`);
  process.exit(0);
}

if (process.argv.includes("--filters")) {
  const cols = [20, 34, 38, 18];
  const run = (A, B, filt, transform) => {
    const p = matchWords(A.refWords, B.genWords);
    if (p.length < MIN_ANCHORS) return 0;
    const frames = transform ? transform(B.genFrames) : B.genFrames;
    return multiScore(A.refFrames, frames, timeMap(A.refWords, B.genWords, p), cols, filt);
  };
  console.log("filter          correct  mismatch  reversed   noise   worstOK  bestBad   margin");
  for (const [name, filt] of Object.entries(FILTERS)) {
    const c = [], m = [], rv = [], nz = [];
    for (let i = 0; i < CASES.length; i++) {
      const A = data[CASES[i]], B = data[CASES[(i + 3) % CASES.length]];
      c.push(run(A, A, filt));
      m.push(run(A, B, filt));
      rv.push(run(A, A, filt, (f) => [...f].reverse()));
      nz.push(run(A, A, filt, (f) => f.map((x) => x.map(() => Math.random()))));
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const worstOK = Math.min(...c), bestBad = Math.max(...m, ...rv, ...nz);
    console.log(
      `${name.padEnd(15)} ${mean(c).toFixed(3).padStart(7)} ${mean(m).toFixed(3).padStart(9)} ` +
      `${mean(rv).toFixed(3).padStart(9)} ${mean(nz).toFixed(3).padStart(7)} ` +
      `${worstOK.toFixed(3).padStart(9)} ${bestBad.toFixed(3).padStart(8)} ${(worstOK - bestBad).toFixed(3).padStart(8)}`
    );
  }
  process.exit(0);
}

if (process.argv.includes("--combos")) {
  const SETS = {
    "jawOpen only": [17],
    "top4 by gap": [20, 34, 38, 18],
    "top6 by gap": [20, 34, 38, 18, 37, 23],
    "low-mismatch 8": [34, 17, 32, 39, 40, 29, 30, 14],
    "pucker+close+lowerDown": [20, 18, 37, 38],
    "all mouth 18-40": Array.from({ length: 23 }, (_, i) => i + 18),
    "articulators 14-40": Array.from({ length: 27 }, (_, i) => i + 14),
  };
  const wrongOf = (A, B, cols, transform) => {
    const p = matchWords(A.refWords, B.genWords);
    if (p.length < MIN_ANCHORS) return 0;
    const frames = transform ? B.genFrames.map(transform) : B.genFrames;
    return multiScore(A.refFrames, frames, timeMap(A.refWords, B.genWords, p), cols);
  };
  console.log("set                        correct  mismatch  reversed   noise   worstOK  bestBad");
  for (const [name, cols] of Object.entries(SETS)) {
    const c = [], m = [], rv = [], nz = [];
    for (let i = 0; i < CASES.length; i++) {
      const A = data[CASES[i]], B = data[CASES[(i + 3) % CASES.length]];
      c.push(wrongOf(A, A, cols));
      m.push(wrongOf(A, B, cols));
      const revA = { ...A, genFrames: [...A.genFrames].reverse() };
      rv.push(wrongOf(A, revA, cols));
      const noiseA = { ...A, genFrames: A.genFrames.map((f) => f.map(() => Math.random())) };
      nz.push(wrongOf(A, noiseA, cols));
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const bestBad = Math.max(...m, ...rv, ...nz);
    console.log(
      `${name.padEnd(24)} ${mean(c).toFixed(3).padStart(7)} ${mean(m).toFixed(3).padStart(9)} ` +
      `${mean(rv).toFixed(3).padStart(9)} ${mean(nz).toFixed(3).padStart(7)} ` +
      `${Math.min(...c).toFixed(3).padStart(9)} ${bestBad.toFixed(3).padStart(8)}`
    );
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ verdict */

// The winning configuration. Picked by --scan (which channels survive the trip
// between two different solvers), --combos (which set of them separates best)
// and --filters (leave the signal alone; the slow component turned out to be
// real articulation, not drift).
const COLS = [20, 34, 38, 18]; // mouthPucker, mouthShrugUpper, mouthLowerDownRight, mouthClose
const FILT = FILTERS["smooth 100ms"];

// What a correct answer can score: 0.936, measured by --ceiling over two Azure
// renderings of the same words in different styles. Used only to put the 0-10
// display on a scale where 10 means "as close as two takes of one sentence
// get" rather than an unreachable perfect 1.0.
const CEILING = 0.936;

function evaluate(A, B, transform) {
  const pairs = matchWords(A.refWords, B.genWords);
  if (pairs.length < MIN_ANCHORS) return null;
  const anchors = timeMap(A.refWords, B.genWords, pairs);
  const frames = transform ? transform(B.genFrames) : B.genFrames;
  return { r: multiScore(A.refFrames, frames, anchors, COLS, FILT), anchors, count: pairs.length };
}

const stdev = (frames, col) => {
  const v = channel(frames, col);
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
};

// Sign convention is the whole value of the lag number, and it is easy to get
// backwards, so it is pinned to a known answer: delay the generation by a known
// amount and the reported lag must move by that amount, in that direction.
if (process.argv.includes("--selfcheck")) {
  const A = data.etf01;
  const measure = (frames) => {
    const p = matchWords(A.refWords, A.genWords);
    return residualLagMs(A.refFrames, frames, timeMap(A.refWords, A.genWords, p), COLS, FILT).lagMs;
  };
  const base = measure(A.genFrames);
  const delay = (n) => [...Array(n).fill(A.genFrames[0]), ...A.genFrames];
  const hurry = (n) => A.genFrames.slice(n);
  for (const [label, frames, want] of [
    ["delayed 100ms", delay(6), base + 100],
    ["advanced 100ms", hurry(6), base - 100],
  ]) {
    const got = measure(frames);
    const ok = Math.abs(got - want) <= 20;
    console.log(`${label}: expected ~${want}ms, got ${got}ms  ${ok ? "OK" : "FAIL"}`);
    if (!ok) process.exit(1);
  }
  console.log(`baseline ${base}ms; positive means the generation's mouth moves late`);
  process.exit(0);
}

const rows = [];
const control = { mismatched: [], reversed: [], noise: [] };
for (let i = 0; i < CASES.length; i++) {
  const A = data[CASES[i]], B = data[CASES[(i + 3) % CASES.length]];
  const hit = evaluate(A, A);
  const { lagMs, rAtBest } = residualLagMs(A.refFrames, A.genFrames, hit.anchors, COLS, FILT);

  // Expressiveness is kept apart from timing on purpose: how far the mouth
  // travels, not when it travels. A generation can be perfectly timed and
  // still read as mumbling, and the two failures want different fixes.
  const expr = COLS.map((c) => stdev(A.genFrames, c) / (stdev(A.refFrames, c) || 1e-9));

  rows.push({
    id: CASES[i],
    timing: +hit.r.toFixed(3),
    score10: +((hit.r / CEILING) * 10).toFixed(1),
    lagMs,
    timingDeLagged: +rAtBest.toFixed(3),
    expressiveness: +(expr.reduce((s, v) => s + v, 0) / expr.length).toFixed(2),
    anchors: hit.count,
    text: A.text,
  });
  control.mismatched.push(evaluate(A, B)?.r ?? 0);
  control.reversed.push(evaluate(A, A, (f) => [...f].reverse()).r);
  control.noise.push(evaluate(A, A, (f) => f.map((x) => x.map(() => Math.random()))).r);
}

console.log("\ncase    anchors  timing   /10      lag   expressiveness");
for (const r of rows) {
  const lag = `${r.lagMs > 0 ? "+" : ""}${r.lagMs}ms`;
  console.log(
    `${r.id}  ${String(r.anchors).padStart(6)}  ${r.timing.toFixed(3).padStart(6)}  ` +
    `${String(r.score10).padStart(4)}  ${lag.padStart(7)}   ${r.expressiveness.toFixed(2)}x`
  );
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const correct = rows.map((r) => r.timing);
const span = (a) => `${mean(a).toFixed(3)}  [${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)}]`;
console.log("\ncontrol -- same metric, deliberately wrong answers");
console.log(`  correct       ${span(correct)}`);
for (const [k, v] of Object.entries(control)) console.log(`  ${k.padEnd(13)}${span(v)}`);
console.log(`  ceiling       ${CEILING}  (same words, different style -- see --ceiling)`);

const bestBad = Math.max(...control.mismatched, ...control.reversed, ...control.noise);
const worstOK = Math.min(...correct);
console.log(`\nseparation: worst correct ${worstOK.toFixed(3)} vs best wrong ${bestBad.toFixed(3)} -> ${worstOK > bestBad ? "CLEAN" : "OVERLAP"}`);

// Every case lags in the same direction, which makes it a constant to correct
// rather than ten separate problems. This is what the score would be if the
// stream were simply played that much earlier.
const lags = rows.map((r) => r.lagMs);
console.log(
  `\nlag is one-sided (${lags.filter((l) => l > 0).length}/${lags.length} late, mean ${Math.round(mean(lags))}ms): ` +
  `timing ${mean(correct).toFixed(3)} -> ${mean(rows.map((r) => r.timingDeLagged)).toFixed(3)} once removed`
);

writeFileSync(
  join(HERE, "scores.js"),
  `// Generated by metric-probe.mjs -- do not edit.\nglobalThis.SCORES = ${
    JSON.stringify(Object.fromEntries(rows.map((r) => [r.id, r])), null, 2)};\n`
);
console.log("wrote eval/scores.js");

