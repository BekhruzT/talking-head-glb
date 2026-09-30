// Screens 3D-ETF clips for whether the captured face is actually lip-synced to
// its own audio -- the test BEAT failed (see eval/README.md). 3D-ETF is
// "pseudo-3D", a blendshape tracker run over YouTube video, so quality varies
// per clip and the corpus must be screened rather than trusted wholesale.
//
// Per clip, against its own audio:
//   r       best-lag correlation of jawOpen with the speech envelope
//   lag     where r peaks; a steady offset is a source A/V delay, subtractable
//   lagSd   spread of that lag across 12s windows -- the real test. A tethered
//           capture agrees with itself; BEAT's scattered over +-800ms.
//   sep     jaw opening during speech vs silence, in sd. Reported, not gated:
//           HDTF is continuous oratory where sub-second "silences" are stop
//           consonants the jaw stays open through, so sep goes negative on
//           perfectly good clips.
//
// Benchmarks: BEAT r 0.25 with scattered lag (unusable), Azure r 0.49 (good,
// but audio-driven by construction, so treat it as an upper bound).
//
// Usage: node eval/inputs2/check-sync.mjs [--all]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RAW = join(import.meta.dirname, "raw");
const LAG_MS = 800;
const SMOOTH_MS = 233; // jaw tracks syllables (~4Hz), not the pitch period;
// raw 30fps RMS is dominated by detail no jaw could follow
const SILENCE_DB = -35;
const SILENCE_MIN_MS = 200;
const WINDOW_S = 12; // the eval cuts 12s cases, so check agreement at that scale
const JAW = 24; // ARKit alphabetical order, confirmed by --all's channel report

export const ARKIT = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight",
  "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
  "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
  "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
  "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight", "tongueOut",
];

/** Minimal .npy reader: 2-D little-endian float arrays. */
export function readNpy(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 6).toString("latin1") !== "\x93NUMPY") throw new Error(`not a .npy: ${path}`);
  const major = buf[6];
  const off = major === 1 ? 10 : 12;
  const hLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const header = buf.subarray(off, off + hLen).toString("latin1");
  if (/'fortran_order':\s*True/.test(header)) throw new Error("fortran order unsupported");
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const [rows, cols] = /'shape':\s*\(([^)]*)\)/.exec(header)[1]
    .split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const start = off + hLen;
  const wide = descr.endsWith("f8");
  if (!wide && !descr.endsWith("f4")) throw new Error(`dtype ${descr} unsupported`);
  const at = wide ? (i) => buf.readDoubleLE(start + i * 8) : (i) => buf.readFloatLE(start + i * 4);
  const frames = [];
  for (let r = 0; r < rows; r++) {
    const row = new Float64Array(cols);
    for (let c = 0; c < cols; c++) row[c] = at(r * cols + c);
    frames.push(row);
  }
  return { descr, rows, cols, frames };
}

/** 16-bit PCM WAV -> mono samples. */
export function readWav(path) {
  const buf = readFileSync(path);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.subarray(pos, pos + 4).toString("latin1");
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === "data") { data = buf.subarray(pos + 8, pos + 8 + size); break; }
    pos += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`bad wav: ${path}`);
  if (fmt.bits !== 16) throw new Error(`${fmt.bits}-bit wav unsupported`);
  const n = Math.floor(data.length / 2 / fmt.channels);
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    samples[i] = s / fmt.channels / 32768;
  }
  return { rate: fmt.rate, channels: fmt.channels, samples, seconds: n / fmt.rate };
}

const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(mean(x.map((v) => (v - m) ** 2))); };

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Box-smooth by +/-w frames, shrinking the window at the edges. */
function smooth(s, w) {
  if (w <= 0) return Array.from(s);
  const sum = new Float64Array(s.length + 1);
  for (let i = 0; i < s.length; i++) sum[i + 1] = sum[i] + s[i];
  return Array.from(s, (_, i) => {
    const lo = Math.max(0, i - w);
    const hi = Math.min(s.length, i + w + 1);
    return (sum[hi] - sum[lo]) / (hi - lo);
  });
}

/** Per-frame RMS of the audio on the blendshape frame grid. */
export function envelope(wav, frames, fps) {
  const env = new Float64Array(frames);
  const step = wav.rate / fps;
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f * step);
    const b = Math.min(wav.samples.length, Math.floor((f + 1) * step));
    let sum = 0;
    for (let i = a; i < b; i++) sum += wav.samples[i] * wav.samples[i];
    env[f] = b > a ? Math.sqrt(sum / (b - a)) : 0;
  }
  return env;
}

/** Frames inside a silence of at least SILENCE_MIN_MS below SILENCE_DB. */
export function silenceMask(env, fps) {
  const floor = 10 ** (SILENCE_DB / 20);
  const min = Math.round((SILENCE_MIN_MS / 1000) * fps);
  const mask = new Uint8Array(env.length);
  let run = 0;
  for (let i = 0; i <= env.length; i++) {
    if (i < env.length && env[i] < floor) { run++; continue; }
    if (run >= min) for (let j = i - run; j < i; j++) mask[j] = 1;
    run = 0;
  }
  return mask;
}

function score(name) {
  const bs = readNpy(join(RAW, `${name}.npy`));
  const wav = readWav(join(RAW, `${name}.wav`));
  const fps = bs.rows / wav.seconds;
  const env = envelope(wav, bs.rows, fps);
  const jaw = bs.frames.map((r) => r[JAW]);

  const w = Math.round((SMOOTH_MS / 1000) * fps / 2);
  const je = smooth(jaw, w), ee = smooth(env, w);
  const maxLag = Math.round((LAG_MS / 1000) * fps);
  const peak = (face, snd) => {
    let best = { r: -2, lag: 0 };
    for (let L = -maxLag; L <= maxLag; L++) {
      const a = [], b = [];
      for (let i = 0; i < face.length; i++) {
        const k = i + L;
        if (k >= 0 && k < face.length) { a.push(face[k]); b.push(snd[i]); }
      }
      if (a.length > 10) { const r = pearson(a, b); if (r > best.r) best = { r, lag: L }; }
    }
    return best;
  };
  const best = peak(je, ee);

  // Does the clip agree with itself? Re-find the lag in each 12s window.
  const win = Math.round(WINDOW_S * fps);
  const lags = [];
  for (let s = 0; s + win <= je.length; s += win) {
    lags.push((peak(je.slice(s, s + win), ee.slice(s, s + win)).lag / fps) * 1000);
  }

  const mask = silenceMask(env, fps);
  const sp = [], si = [];
  for (let i = 0; i < jaw.length; i++) (mask[i] ? si : sp).push(jaw[i]);
  const spread = sd(jaw) || 1;
  const sep = si.length >= 0.02 * jaw.length ? (mean(sp) - mean(si)) / spread : null;

  return {
    name, fps, seconds: wav.seconds, rate: wav.rate, cols: bs.cols, dtype: bs.descr,
    r0: pearson(je, ee), rbest: best.r, lagMs: (best.lag / fps) * 1000,
    lagSd: lags.length > 1 ? sd(lags) : null, windows: lags.length,
    sep, quiet: si.length / jaw.length, jawPeak: Math.max(...jaw), jawMean: mean(jaw),
  };
}

// Tracks the audio, and agrees with itself about when. Long enough to cut a
// 12s case out of. sep is reported for information only -- see the note above.
export const PASS = (r) => r.rbest >= 0.45 && r.lagSd !== null && r.lagSd <= 100 && r.seconds >= 30;

// Run the sweep only when invoked directly; build-etf-fixture imports the
// readers above.
if (process.argv[1]?.includes("check-sync")) {
const names = readdirSync(RAW).filter((f) => f.endsWith(".npy")).map((f) => f.slice(0, -4)).sort();
const rows = [];
for (const n of names) {
  try { rows.push(score(n)); } catch (e) { console.log(`skip ${n}: ${e.message}`); }
}
rows.sort((a, b) => b.rbest - a.rbest);

const pass = rows.filter(PASS);
console.log(`\n3D-ETF HDTF screen -- ${rows.length} clips, ${rows[0].cols}ch ${rows[0].dtype} @ ${rows[0].fps.toFixed(0)}fps\n`);
console.log("clip                             secs  rbest     lag  lagSd    sep  jawPk  pass");
for (const r of rows.slice(0, 30)) {
  console.log(
    `${r.name.padEnd(31)} ${r.seconds.toFixed(0).padStart(5)} ${r.rbest.toFixed(2).padStart(6)} ` +
    `${(r.lagMs.toFixed(0) + "ms").padStart(7)} ${(r.lagSd === null ? "n/a" : r.lagSd.toFixed(0) + "ms").padStart(6)} ` +
    `${(r.sep === null ? "n/a" : r.sep.toFixed(2)).padStart(6)} ${r.jawPeak.toFixed(2).padStart(6)}  ${PASS(r) ? "YES" : ""}`
  );
}
console.log(`... ${rows.length - 30} more, see screen.json`);
const good = (k) => mean(pass.map(k));
console.log(`\n${pass.length}/${rows.length} clips pass (r>=0.45, lagSd<=100ms, >=30s)`);
if (pass.length) {
  console.log(`passing means:  r ${good((r) => r.rbest).toFixed(2)}   |lag| ${good((r) => Math.abs(r.lagMs)).toFixed(0)}ms   ` +
    `lagSd ${good((r) => r.lagSd).toFixed(0)}ms   sep ${good((r) => r.sep ?? 0).toFixed(2)}   ` +
    `total ${(pass.reduce((s, r) => s + r.seconds, 0) / 60).toFixed(0)} min`);
}
console.log(`benchmarks:     BEAT r 0.25 / lag scattered +-800ms      Azure r 0.49 / lag ~0`);

writeFileSync(
  join(import.meta.dirname, "screen.json"),
  JSON.stringify(rows.map((r) => ({ ...r, pass: PASS(r) })), null, 1)
);
console.log(`\nwrote screen.json`);
}
