// Browser-side check that a head carries every motion layer, not just loads.
// Needs the eval server (node eval/inputs/upload-server.mjs) for fixtures and
// frame uploads. Load the app with ?probe, paste this file, run stubMic(), then
// click the mic for real (the click is what lets the voice autoplay) and run:
//
//   http://localhost:3000/?probe&model=medical-female-01
//   await probeIdle(16000)      // blinks, gaze, expressions, neck while idle
//   await probeSpeech("etf01")  // replays the fixture, scores the mouth
//
// Values are read off the rig after the frame loop wrote them, so a channel the
// model cannot move reads 0 here even though the animation code asked for it.

const EVAL = "http://localhost:4100";
const STREAM_FPS = 60;
const SPEECH = ["jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthLowerDownLeft", "mouthUpperUpLeft", "mouthSmileLeft"];
const VISEMES = ["ae_ax_ah_01", "aa_02", "ao_03", "ey_eh_uh_04", "er_05", "y_iy_ih_ix_06", "w_uw_07", "ow_08", "aw_09", "oy_10", "ay_11", "h_12", "r_13", "l_14", "s_z_15", "sh_ch_jh_zh_16", "th_dh_17", "f_v_18", "d_t_n_19", "k_g_ng_20", "p_b_m_21"];
const AZURE = ["eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft", "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight", "jawForward", "jawLeft", "jawRight", "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight", "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "noseSneerLeft", "noseSneerRight", "tongueOut"];
const GROUPS = {
  blink: ["eyeBlinkLeft", "eyeBlinkRight"],
  gaze: ["eyeLookUpLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft"],
  expression: ["mouthSmileLeft", "browInnerUp", "cheekSquintLeft", "eyeSquintLeft", "mouthDimpleLeft", "browDownLeft"],
  neckChannels: ["HeadUp", "HeadDown", "TrunLeft", "TrunRight"],
};
const frame = () => new Promise((r) => requestAnimationFrame(r));

// Call before clicking the mic: speech reaches the app only through the recogniser.
function stubMic() {
  function FakeRecognition() { window.__rec = this; }
  FakeRecognition.prototype.start = FakeRecognition.prototype.stop = FakeRecognition.prototype.abort = () => {};
  window.SpeechRecognition = FakeRecognition;
}
const rig = () => window.__avatar;

async function shot(name) {
  const blob = await new Promise((r) => document.querySelector("canvas").toBlob(r, "image/png"));
  await fetch(`${EVAL}/upload?name=${name}`, { method: "POST", body: blob });
}

function headAngle(q0) {
  const q = rig().headBone?.quaternion;
  return q && q0 ? 2 * Math.acos(Math.min(1, Math.abs(q.dot(q0)))) : 0;
}

async function probeIdle(ms, tag = new URLSearchParams(location.search).get("model") || "ava") {
  const q0 = rig().headBone?.quaternion.clone();
  const peak = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0]));
  let bone = 0, frames = 0, shotBlink = false, shotNeck = false;
  for (const t0 = performance.now(); performance.now() - t0 < ms; frames++) {
    await frame();
    for (const [group, names] of Object.entries(GROUPS)) {
      peak[group] = Math.max(peak[group], ...names.map((n) => (n in rig().indices ? rig().read(n) : 0)));
    }
    bone = Math.max(bone, headAngle(q0));
    if (!shotBlink && rig().read("eyeBlinkLeft") > 0.9) { shotBlink = true; shot(`rig-${tag}-blink.png`); }
    if (!shotNeck && peak.neckChannels > 0.08) { shotNeck = true; shot(`rig-${tag}-neck.png`); }
  }
  const round = (v) => +v.toFixed(3);
  return { frames, fps: round(frames / (ms / 1000)), ...Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, round(v)])), headBoneRad: round(bone), neckByBone: !!rig().headBone && rig().virtual.size > 0 };
}

// Answers the app's next /tts with `fixture` and says its text into the stubbed
// mic; resolves with the playing Audio, or an error string.
async function speak(fixture) {
  const nativeFetch = window.__nativeFetch || (window.__nativeFetch = window.fetch.bind(window));
  window.fetch = (input, init) => String(input.url || input).endsWith("/tts")
    ? Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 }))
    : nativeFetch(input, init);
  const NativeAudio = window.__NativeAudio || (window.__NativeAudio = window.Audio);
  let audio;
  window.Audio = function (src) { return (audio = new NativeAudio(src)); };
  window.Audio.prototype = NativeAudio.prototype;
  if (!window.__rec) throw new Error("no recogniser: install a SpeechRecognition stub and click the mic first");
  window.__rec.onresult({ results: { 0: [{ transcript: fixture.text }] } });
  for (const t0 = Date.now(); !audio || audio.currentTime === 0; await frame()) {
    if (Date.now() - t0 > 15000) return audio ? "audio never started (autoplay blocked?)" : "app never built an Audio";
  }
  return audio;
}

// Two Microsoft visemes folded onto one Oculus target (h_12 and ey_eh_uh_04 are
// both E) alternate with no closure between them, so the shared morph should
// hold up through every crossfade instead of dipping when one fades out.
async function probeSharedViseme(id) {
  const fixture = await fetch(`${EVAL}/fixture?id=${id}`).then((r) => r.json());
  delete fixture.blendShapeFrames;
  fixture.visemes = Array.from({ length: 40 }, (_, i) => ({ audioOffset: (200 + i * 150) * 1e4, visemeId: i % 2 ? 4 : 12 }));
  const slot = rig().indices.h_12;
  const m = rig().rig.slots.findIndex((row) => row[slot] >= 0);
  const target = rig().rig.slots[m][slot];
  const audio = await speak(fixture);
  if (typeof audio === "string") return { id, error: audio };
  let min = 1, frames = 0;
  while (!audio.ended && !audio.paused && audio.currentTime < 6) {
    await frame();
    const ms = audio.currentTime * 1000;
    if (ms < 700 || ms > 5800) continue;
    min = Math.min(min, rig().meshes[m].morphTargetInfluences[target]);
    frames++;
  }
  audio.pause();
  return { id, sharedWith: rig().rig.shared.get(slot), frames, minSharedMorph: +min.toFixed(3) };
}

// visemesOnly drops the blendshape stream, so the mouth runs on the viseme
// fallback (what a TTS without facial output gives) and is scored by how many
// distinct viseme shapes actually moved rather than by correlation. The etf
// fixtures carry only placeholder visemes, so this walks every Azure viseme id
// at a speaking pace instead; it proves each shape drives the head, not sync.
async function probeSpeech(id, { visemesOnly = false, tag = new URLSearchParams(location.search).get("model") || "ava" } = {}) {
  const fixture = await fetch(`${EVAL}/fixture?id=${id}`).then((r) => r.json());
  if (visemesOnly) {
    delete fixture.blendShapeFrames;
    fixture.visemes = Array.from({ length: 70 }, (_, i) => ({ audioOffset: (200 + i * 150) * 1e4, visemeId: i % 8 === 7 ? 0 : 1 + (i % 21) }));
  }
  const names = visemesOnly ? VISEMES : SPEECH;
  tag += visemesOnly ? "-visemes" : "";
  const audio = await speak(fixture);
  if (typeof audio === "string") return { id, error: audio };
  const samples = [];
  let open = { v: -1 }, closed = { v: 2 }, shotOpen = false;
  while (!audio.ended && !audio.paused) {
    await frame();
    const ms = audio.currentTime * 1000;
    const row = Object.fromEntries(names.map((n) => [n, rig().read(n)]));
    const mouth = visemesOnly ? Math.max(...Object.values(row)) : row.jawOpen;
    samples.push({ ms, row });
    if (!shotOpen && mouth >= 0.35) { shotOpen = true; shot(`rig-${tag}-speech-open.png`); }
    if (ms > 300 && mouth > open.v) open = { v: mouth, ms };
    if (ms > 300 && mouth < closed.v) closed = { v: mouth, ms };
  }
  const peak = Object.fromEntries(names.map((n) => [n, +Math.max(...samples.map((s) => s.row[n])).toFixed(3)]));
  const summary = { id, tag, seconds: +audio.duration.toFixed(2), samples: samples.length, fps: +(samples.length / audio.duration).toFixed(1), mouthOpenAt: open, mouthClosedAt: closed };
  if (visemesOnly) return { ...summary, visemesMoved: Object.values(peak).filter((v) => v > 0.1).length, of: names.length, peak };

  // The app normalises the stream (rest pose subtracted, a deadzone on two
  // rounding channels), so compare shape, not value: Pearson r against the raw
  // fixture channel at the same audio time.
  const pearson = (a, b) => {
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let num = 0, da = 0, db = 0;
    a.forEach((v, i) => { num += (v - ma) * (b[i] - mb); da += (v - ma) ** 2; db += (b[i] - mb) ** 2; });
    return da && db ? num / Math.sqrt(da * db) : 0;
  };
  const inStream = samples.filter((s) => s.ms / 1000 * STREAM_FPS < fixture.blendShapeFrames.length - 1);
  const source = (name, ms) => fixture.blendShapeFrames[Math.round(ms / 1000 * STREAM_FPS)][AZURE.indexOf(name)];
  const correlation = Object.fromEntries(SPEECH.map((n) => [n, +pearson(inStream.map((s) => s.row[n]), inStream.map((s) => source(n, s.ms))).toFixed(3)]));
  return { ...summary, correlation, peak };
}
