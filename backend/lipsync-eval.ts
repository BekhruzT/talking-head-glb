/**
 * Offline lip-sync evaluation harness.
 *
 *   node --env-file=../.env lipsync-eval.ts record    # synthesize the test cases once, save fixtures
 *   node lipsync-eval.ts compare                      # score transform variants against the fixtures
 *
 * The idea: the previous generation (viseme-id scheduler) looked acceptable, so
 * its output is the baseline. One Azure synthesis per test case yields BOTH
 * streams -- viseme-id events and 55-channel blendshape frames -- so each
 * fixture carries the baseline and the candidate data for the same audio.
 * The viseme ids double as phonetic ground truth: they say when the mouth
 * must be shut (p/b/m, silence), open (aa/ay/aw) or rounded (w/uw/ow/oy),
 * and the metrics check the blendshape stream against those moments.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SpeechConfig,
  SpeechSynthesizer,
  SpeechSynthesisOutputFormat,
} from "microsoft-cognitiveservices-speech-sdk";
import { normalizeFrames } from "../frontend/src/components/avatar/blendshape-stream.ts";

const FIXTURE_DIR = join(import.meta.dirname, "eval-fixtures");
const FPS = 60;

// Chosen to probe specific failure modes, not to be conversational.
const CASES: { id: string; text: string }[] = [
  { id: "bilabials", text: "Bump the pump, Mabel. Pop by my map." },
  { id: "round-vowels", text: "Oh no, don't go below. Show me your boat." },
  { id: "wide-vowels", text: "The car parked far from the java bar." },
  { id: "greeting", text: "Hi there! How are you doing today?" },
  { id: "pauses", text: "Wait. Okay. Sure, let me think about it." },
  { id: "sibilants", text: "She sells seashells by the seashore." },
  { id: "question", text: "Could you please tell me where the station is?" },
  { id: "numbers", text: "Three hundred forty seven plus one twenty nine." },
  { id: "function-words", text: "I think it would be a good idea to do it now." },
  { id: "hums", text: "Hmm, mmm, well, maybe." },
  { id: "minimal-pairs", text: "Pat bought a pot of hot coffee." },
  {
    id: "long",
    text: "The weather this morning was surprisingly pleasant, so we walked along the river before breakfast. Nobody wanted to go back inside.",
  },
];

interface VisemeEvent { t: number; id: number } // t in ms on the audio timeline
interface Fixture { id: string; text: string; visemes: VisemeEvent[]; frames: number[][] }

// ---------------------------------------------------------------- recording

function synthesizeCase(c: { id: string; text: string }): Promise<Fixture> {
  return new Promise((resolve, reject) => {
    const cfg = SpeechConfig.fromSubscription(process.env.SPEECH_KEY!, process.env.SPEECH_REGION!);
    cfg.speechSynthesisLanguage = "en-US";
    cfg.speechSynthesisVoiceName = "en-US-JennyNeural";
    cfg.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
    const synth = new SpeechSynthesizer(cfg);

    const visemes: VisemeEvent[] = [];
    const frames: number[][] = [];
    synth.visemeReceived = (_s, e) => {
      if (e.animation) {
        const chunk = JSON.parse(e.animation);
        (chunk.BlendShapes ?? []).forEach((frame: number[], i: number) => {
          // same 2-decimal rounding the shipped tts handler applies
          frames[chunk.FrameIndex + i] = frame.map((v) => Math.round(v * 100) / 100);
        });
        return;
      }
      visemes.push({ t: e.audioOffset / 10000, id: e.visemeId });
    };

    // identical SSML shape to handlers/tts.ts, default chat style
    const ssml = `<speak version='1.0' xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang='en-US'><voice name='en-US-JennyNeural'><mstts:viseme type='FacialExpression'/><mstts:express-as style='chat'>${c.text}</mstts:express-as></voice></speak>`;
    synth.speakSsmlAsync(
      ssml,
      () => { synth.close(); resolve({ id: c.id, text: c.text, visemes, frames }); },
      (err) => { synth.close(); reject(err); }
    );
  });
}

async function record() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const c of CASES) {
    const fx = await synthesizeCase(c);
    writeFileSync(join(FIXTURE_DIR, `${c.id}.json`), JSON.stringify(fx));
    console.log(`recorded ${c.id}: ${fx.frames.length} frames, ${fx.visemes.length} viseme events`);
  }
}

// ------------------------------------------- previous-generation simulation

// Per viseme id: how open / how rounded the dedicated rig shape is at full
// influence. Judgment values from standard phonetics; only used to project the
// old system's shape-space trajectory into the same [openness, roundness]
// space the new stream is measured in.
const VISEME_POSE: { [id: number]: [open: number, round: number] } = {
  0: [0, 0], 1: [0.6, 0], 2: [0.8, 0], 3: [0.6, 0.4], 4: [0.45, 0], 5: [0.35, 0.2],
  6: [0.25, 0], 7: [0.15, 0.8], 8: [0.3, 0.7], 9: [0.6, 0.3], 10: [0.4, 0.5],
  11: [0.7, 0], 12: [0.3, 0], 13: [0.25, 0.3], 14: [0.3, 0], 15: [0.1, 0],
  16: [0.15, 0.4], 17: [0.15, 0], 18: [0.1, 0], 19: [0.15, 0], 20: [0.2, 0], 21: [0, 0],
};

const EASE: { [k: string]: (a: number, b: number, t: number) => number } = {
  lerp: (a, b, t) => b * t + a * (1 - t),
  easeOutQuad: (a, b, t) => b * (1 - (1 - t) ** 2) + a * (1 - t) ** 2,
  easeOutQuart: (a, b, t) => b * (1 - (1 - t) ** 4) + a * (1 - t) ** 4,
};

interface Segment { t0: number; dur: number; v0: number; v1: number; ease: string }

/**
 * Faithful port of the old animateLipSync scheduler in glb-avatar.tsx,
 * emitting animation segments per viseme id instead of writing to morph
 * targets. "mouthClose" in the original is viseme id 0.
 */
function simulateOldScheduler(visemes: VisemeEvent[]): Map<number, Segment[]> {
  let evs = visemes.map((v) => ({ time: v.t, id: v.id }));
  // dropSecondMouthClose
  evs = evs.filter((e, i) => !(e.id === 0 && evs[i - 1]?.id === 0));
  // dropQuickSounds
  let lastDropped = -2;
  evs = evs.filter((e, i) => {
    if (i === 0) return true;
    const dPrev = e.time - evs[i - 1].time;
    const dNext = evs[i + 1] ? evs[i + 1].time - e.time : Infinity;
    if (dPrev + dNext < 120 && lastDropped !== i - 1) { lastDropped = i; return false; }
    return true;
  });

  const segs = new Map<number, Segment[]>();
  const emit = (id: number, t0: number, dur: number, v0: number, v1: number, ease: string) => {
    if (!segs.has(id)) segs.set(id, []);
    segs.get(id)!.push({ t0, dur, v0, v1, ease });
  };

  if (evs[0].id !== 0) emit(evs[0].id, evs[0].time, evs[1].time - evs[0].time, 0, 1, "easeOutQuad");
  const dummy = 200;
  let reverse = true;
  for (let i = 1; i < evs.length; i++) {
    const prev = evs[i - 1];
    const cur = evs[i];
    const nextTime = evs[i + 1] ? evs[i + 1].time : cur.time + dummy;
    const nextId = evs[i + 1]?.id;
    let dur = nextTime - cur.time;

    if (cur.id !== 0) {
      if (prev.id === 0) {
        emit(cur.id, cur.time, dur, 0, 1, "easeOutQuad");
      } else {
        if (nextId === 0 && dur > 500) {
          dur = dummy;
          emit(cur.id, cur.time + dur, 250, 1, 0, "easeOutQuart");
          reverse = false;
        }
        emit(cur.id, cur.time, dur, 0, 1, "easeOutQuad");
        emit(prev.id, cur.time, dur, 1, 0, "easeOutQuart");
      }
    } else if (prev.id !== 0) {
      if (reverse) emit(prev.id, cur.time, dur, 1, 0, "easeOutQuart");
      else reverse = true;
    }
  }
  return segs;
}

/** Old-system [openness, roundness] curve sampled at 60fps. */
function oldPoseCurve(visemes: VisemeEvent[], nFrames: number): [number, number][] {
  const segs = simulateOldScheduler(visemes);
  const out: [number, number][] = [];
  for (let f = 0; f < nFrames; f++) {
    const t = (f / FPS) * 1000;
    let open = 0, round = 0;
    for (const [id, list] of segs) {
      // like the render loop: the most recently started segment owns the shape
      let active: Segment | undefined;
      for (const s of list) if (s.t0 <= t && (!active || s.t0 > active.t0)) active = s;
      if (!active) continue;
      const p = Math.min((t - active.t0) / active.dur, 1);
      const v = EASE[active.ease](active.v0, active.v1, p);
      open += v * VISEME_POSE[id][0];
      round += v * VISEME_POSE[id][1];
    }
    out.push([Math.min(open, 1), Math.min(round, 1)]);
  }
  return out;
}

// ------------------------------------------------------------------ metrics

// Azure channel indices (verified against the docs table)
const JAW_OPEN = 17, MOUTH_CLOSE = 18, FUNNEL = 19, PUCKER = 20, LOWER_L = 37, LOWER_R = 38;
// visible lip aperture, ARKit semantics: mouthClose closes the lips over an
// open jaw, so what the viewer sees is the difference, not jawOpen alone
const openness = (f: number[]) =>
  Math.max(0, f[JAW_OPEN] - f[MOUTH_CLOSE]) + 0.3 * (f[LOWER_L] + f[LOWER_R]) / 2;
const roundness = (f: number[]) => f[FUNNEL] + f[PUCKER];

const ROUNDED_IDS = new Set([3, 7, 8, 10, 13, 16]);
const WIDE_IDS = new Set([2, 9, 11]);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
// cases that lack a phoneme class (e.g. no wide vowel in "sibilants") yield NaN; skip them
const nanmean = (xs: number[]) => mean(xs.filter((x) => !Number.isNaN(x)));
const p90 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] : NaN);

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** viseme id owning the audio timeline at time t (events cover [t_i, t_i+1)) */
function visemeAt(visemes: VisemeEvent[], t: number): number {
  let id = 0;
  for (const v of visemes) { if (v.t <= t) id = v.id; else break; }
  return id;
}

/** silence = viseme-0 stretches longer than 300ms, trimmed 120ms at the head so the mouth has time to close */
function isSilence(visemes: VisemeEvent[], t: number): boolean {
  let start = 0, id = 0, result = false;
  for (const v of [...visemes, { t: Infinity, id: -1 }]) {
    if (t < v.t) { result = id === 0 && v.t - start > 300 && t > start + 120; break; }
    if (v.id !== id) { start = v.t; id = v.id; }
  }
  return result;
}

interface Metrics {
  restOpen: number;    // mean openness during silence -- should be ~0
  bilabial: number;    // mean openness right after p/b/m onsets -- should be ~0
  widePeak: number;    // p90 openness inside wide vowels -- the working range
  maxOpen: number;     // absolute worst-case openness -- the "opens way too much" flag
  oPedestal: number;   // mean funnel+pucker during NON-rounded speech -- the "O basis" flag
  oPeak: number;       // mean funnel+pucker inside rounded visemes -- must stay >> pedestal
  corrOld: number;     // Pearson r of openness curve vs old viseme-id system
}

function measure(frames: number[][], visemes: VisemeEvent[]): Metrics {
  const old = oldPoseCurve(visemes, frames.length);
  const rest: number[] = [], bil: number[] = [], wide: number[] = [];
  const ped: number[] = [], opk: number[] = [], opens: number[] = [];
  let maxOpen = 0;

  frames.forEach((f, i) => {
    if (!f) return;
    const t = (i / FPS) * 1000;
    const o = openness(f), r = roundness(f);
    opens.push(o);
    maxOpen = Math.max(maxOpen, o);
    const silent = isSilence(visemes, t);
    if (silent) { rest.push(o); return; }
    const id = visemeAt(visemes, t);
    if (WIDE_IDS.has(id)) wide.push(o);
    if (ROUNDED_IDS.has(id)) opk.push(r);
    else ped.push(r);
  });
  for (const v of visemes) {
    if (v.id !== 21) continue;
    for (let t = v.t + 20; t <= v.t + 100; t += 1000 / FPS) {
      const f = frames[Math.round((t / 1000) * FPS)];
      if (f) bil.push(openness(f));
    }
  }
  return {
    restOpen: mean(rest),
    bilabial: mean(bil),
    widePeak: p90(wide),
    maxOpen,
    oPedestal: mean(ped),
    oPeak: mean(opk),
    corrOld: pearson(opens, old.map(([o]) => o)),
  };
}

// ---------------------------------------------------------------- variants

// local rest-pose subtraction so candidate variants stay independent of
// whatever normalizeFrames currently ships (that one gets its own row)
const minGain = (frames: number[][], gain: number) => {
  const rest = frames.reduce((min, f) => min.map((v, i) => Math.min(v, f[i])), frames[0]);
  return frames.map((f) => f.map((v, i) => Math.min(1, (v - rest[i]) * gain)));
};
// reshape funnel+pucker after normalization: rig calibration against the O pedestal.
// scale keeps the pedestal/peak ratio; a deadzone removes the pedestal and keeps the peaks.
const damped = (gain: number, roundFn: (v: number) => number) => (f: number[][]) =>
  minGain(f, gain).map((row) =>
    row.map((v, i) => (i === FUNNEL || i === PUCKER ? roundFn(v) : v))
  );

const VARIANTS: { name: string; fn: (frames: number[][]) => number[][] }[] = [
  { name: "raw (original)", fn: (f) => f },
  { name: "min+gain2.5 (1st fix)", fn: (f) => minGain(f, 2.5) },
  { name: "min+gain1.0", fn: (f) => minGain(f, 1.0) },
  { name: "min+gain1.3", fn: (f) => minGain(f, 1.3) },
  { name: "g1.0 round*0.5", fn: damped(1.0, (v) => v * 0.5) },
  { name: "g1.0 rnd-dz0.10*1.5", fn: damped(1.0, (v) => Math.max(0, v - 0.10) * 1.5) },
  { name: "g1.0 rnd-dz0.12*1.4", fn: damped(1.0, (v) => Math.max(0, v - 0.12) * 1.4) },
  { name: "g1.0 rnd-dz0.15*1.6", fn: damped(1.0, (v) => Math.max(0, v - 0.15) * 1.6) },
  { name: "SHIPPED normalizeFrames", fn: (f) => normalizeFrames(f) },
];

function compare() {
  const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")));
  console.log(`${fixtures.length} fixtures\n`);

  const cols = ["restOpen", "bilabial", "widePeak", "maxOpen", "oPedestal", "oPeak", "corrOld"] as const;
  const targets = "targets: restOpen~0 bilabial~0 widePeak 0.25-0.55 maxOpen<0.7 oPedestal<<oPeak corrOld high";
  console.log(targets + "\n");
  console.log("variant".padEnd(24) + cols.map((c) => c.padStart(10)).join(""));

  for (const v of VARIANTS) {
    const per = fixtures.map((fx) => measure(v.fn(fx.frames.filter(Boolean)), fx.visemes));
    const agg = cols.map((c) => nanmean(per.map((m) => m[c])));
    console.log(v.name.padEnd(24) + agg.map((x) => x.toFixed(3).padStart(10)).join(""));
  }

  // the old system, projected into the same measurement space, as reference
  const oldRows = fixtures.map((fx) => {
    const curve = oldPoseCurve(fx.visemes, fx.frames.filter(Boolean).length);
    const opens = curve.map(([o]) => o);
    const silent = opens.filter((_, i) => isSilence(fx.visemes, (i / FPS) * 1000));
    const ped: number[] = [], opk: number[] = [];
    curve.forEach(([, r], i) => {
      const t = (i / FPS) * 1000;
      if (isSilence(fx.visemes, t)) return;
      (ROUNDED_IDS.has(visemeAt(fx.visemes, t)) ? opk : ped).push(r);
    });
    return { rest: mean(silent), peak: p90(opens), max: Math.max(...opens), ped: mean(ped), opk: mean(opk) };
  });
  console.log(
    "\nold viseme-id baseline (same space, via pose weights):\n" +
    `  restOpen=${nanmean(oldRows.map((r) => r.rest)).toFixed(3)} ` +
    `p90Open=${nanmean(oldRows.map((r) => r.peak)).toFixed(3)} ` +
    `maxOpen=${nanmean(oldRows.map((r) => r.max)).toFixed(3)} ` +
    `oPedestal=${nanmean(oldRows.map((r) => r.ped)).toFixed(3)} ` +
    `oPeak=${nanmean(oldRows.map((r) => r.opk)).toFixed(3)}`
  );
}

const cmd = process.argv[2];
if (cmd === "record") await record();
else if (cmd === "compare") compare();
else console.log("usage: node --env-file=../.env lipsync-eval.ts record | node lipsync-eval.ts compare");
