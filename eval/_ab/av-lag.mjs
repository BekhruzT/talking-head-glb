// Measures how far a capture's audio sits from its own mouth motion. Both
// signals are sampled at 50Hz, the resolution the answer is quoted at. The
// mouth signal is luminance spread in a crop over the lips (an open mouth adds
// a dark interior, so spread rises with articulation) -- a weak proxy, r~0.44
// against its own audio, but enough to locate a correlation peak.
//
// Positive lag = audio arrives LATE relative to the mouth.
//
//   node eval/_ab/av-lag.mjs eval/_ab/dry.webm ...
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const HOP = 320, RATE = 16000, FPS = 50; // 20ms both sides
const CROP = "260:160:830:560"; // lips, at the 1920x1020 the canvas records
const GW = 64, GH = 40;
const MAX_LAG = 20; // frames, +/-400ms

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function z(a) {
  const m = mean(a);
  const sd = Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1;
  return a.map((x) => (x - m) / sd);
}

function correlate(a, b) {
  const n = Math.min(a.length, b.length);
  return mean(a.slice(0, n).map((x, i) => x * b[i]));
}

function mouthSignal(file) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file,
    "-vf", `crop=${CROP},scale=${GW}:${GH},fps=${FPS},format=gray`,
    "-f", "rawvideo", "-pix_fmt", "gray", "_mouth.raw"]);
  const b = readFileSync("_mouth.raw");
  const px = GW * GH;
  const out = [];
  for (let f = 0; f + px <= b.length; f += px) {
    let sum = 0, sq = 0;
    for (let i = 0; i < px; i++) { const v = b[f + i]; sum += v; sq += v * v; }
    out.push(Math.sqrt(sq / px - (sum / px) ** 2)); // spread, not brightness
  }
  unlinkSync("_mouth.raw");
  return out;
}

function audioSignal(file) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file,
    "-ac", "1", "-ar", String(RATE), "-f", "s16le", "_audio.raw"]);
  const b = readFileSync("_audio.raw");
  const n = b.length / 2;
  const out = [];
  for (let i = 0; i + HOP <= n; i += HOP) {
    let s = 0;
    for (let j = 0; j < HOP; j++) { const v = b.readInt16LE((i + j) * 2) / 32768; s += v * v; }
    out.push(Math.sqrt(s / HOP));
  }
  unlinkSync("_audio.raw");
  return out;
}

for (const file of process.argv.slice(2)) {
  const mouth = z(mouthSignal(file));
  const audio = z(audioSignal(file));
  let best = { r: -2, lag: 0 };
  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag++) {
    // lag > 0 shifts audio earlier to meet the mouth, i.e. audio was late.
    const a = lag >= 0 ? audio.slice(lag) : audio.slice(0, audio.length + lag);
    const m = lag >= 0 ? mouth.slice(0, mouth.length - lag) : mouth.slice(-lag);
    const r = correlate(m, a);
    if (r > best.r) best = { r, lag };
  }
  const at0 = correlate(mouth, audio);
  console.log(
    `${file.padEnd(30)} bestLag ${String(best.lag * 20).padStart(5)}ms  r ${best.r.toFixed(3)}  (r at 0ms ${at0.toFixed(3)})`
  );

  // Speech is quasi-periodic at ~4Hz, so an argmax over +/-400ms can lock onto a
  // neighbouring syllable. Print the curve: trust the answer only if there is
  // one clear peak rather than several of similar height.
  if (process.env.CURVE) {
    for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 2) {
      const a = lag >= 0 ? audio.slice(lag) : audio.slice(0, audio.length + lag);
      const m = lag >= 0 ? mouth.slice(0, mouth.length - lag) : mouth.slice(-lag);
      const r = correlate(m, a);
      const bar = "#".repeat(Math.max(0, Math.round(r * 60)));
      console.log(`  ${String(lag * 20).padStart(5)}ms ${r.toFixed(3).padStart(6)} ${bar}`);
    }
  }
}
