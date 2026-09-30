// Browser-side recording harness for the eval corpus. Needs a real WebGL canvas
// and the page's own audio clock, so it cannot be a node script. Paste into the
// devtools console after picking "Ava" and waiting for the canvas:
//
//   http://localhost:3000/?noExpressions=1&noHeadMovement=1
//   installHarness(); micOn()
//   await record("etf01", "reference")    // replays inputs2/etf01/fixture.json
//   await record("case01", "generation")  // real backend /tts, speaks the text
//   node eval/inputs/convert-captures.mjs reference
//
// The two URL flags stop the idle layer and the neck, which run on timers
// unrelated to speech and would leak into the mouth-box signal. Keep the window
// frontmost: the avatar renders on rAF, which Chrome throttles when
// backgrounded, and convert-captures rejects captures under 10fps.

function installHarness() {
  if (window.__harness) return "already installed";
  window.__harness = true;
  const EVAL = "http://localhost:4100";
  const NativeAudio = window.Audio;
  window.__nativeFetch = window.fetch.bind(window);

  // The app speaks through a detached `new Audio(url)` that never enters the
  // DOM, so patching construction is the only hook; arming the recorder here,
  // before the app's next line calls .play(), is what keeps the tracks aligned.
  // Audio must route through Web Audio rather than audio.captureStream(): at
  // construction the element has no metadata yet, so captureStream() returns
  // zero audio tracks and MediaRecorder records silent video. One AudioContext
  // for the page, since a fresh one per utterance exhausts them mid-corpus; it
  // also feeds ctx.destination, or routing into the graph mutes the page. Do
  // not mute the tab -- that mutes the element and the capture records silence.
  const PatchedAudio = function (src) {
    const a = new NativeAudio(src);
    window.__lastAudio = a;
    window.__audioSeq = (window.__audioSeq || 0) + 1;
    const armed = window.__armed;
    if (armed && !armed.rec) {
      try {
        const ctx = window.__evalCtx || (window.__evalCtx = new AudioContext());
        // Only one MediaElementAudioSourceNode may exist per element, which is
        // safe here because the app builds a new Audio for every utterance.
        const source = ctx.createMediaElementSource(a);
        const dest = ctx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(ctx.destination);
        const v = document.querySelector("canvas").captureStream(30);
        const mixed = new MediaStream([...v.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        if (!mixed.getAudioTracks().length) throw new Error("no audio track in capture stream");
        const rec = new MediaRecorder(mixed, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 6e6 });
        armed.chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) armed.chunks.push(e.data); };
        armed.stopped = new Promise((r) => { rec.onstop = r; });
        rec.start();
        armed.rec = rec;
        armed.release = () => { mixed.getTracks().forEach((t) => t.stop()); source.disconnect(dest); };
      } catch (err) { armed.error = String(err); }
    }
    return a;
  };
  PatchedAudio.prototype = NativeAudio.prototype;
  window.Audio = PatchedAudio;

  // Speech only reaches the app through the mic, so stand in for the recogniser
  // (also stops the real one from listening to the room mid-capture).
  function FakeRecognition() { window.__rec = this; }
  FakeRecognition.prototype.start = function () { };
  FakeRecognition.prototype.stop = function () { };
  FakeRecognition.prototype.abort = function () { };
  window.SpeechRecognition = FakeRecognition;

  // Reference column answers /tts from the fixture without touching the
  // network. Generation reaches the real backend but rewrites the body from
  // `{chat, messages}` to `{text, emotion}`: the chat branch would speak an
  // LLM's *reply* to the transcript, so the columns would be saying different
  // sentences and the comparison would measure nothing.
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url && url.endsWith("/tts")) {
      if (window.__fixture) {
        return new Response(JSON.stringify(window.__fixture), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (window.__speak) {
        init = { ...init, body: JSON.stringify({ text: window.__speak, emotion: "neutral" }) };
      }
    }
    return window.__nativeFetch(input, init);
  };

  // The GLB loads async and an empty r3f canvas renders black, so a recorder
  // armed too early burns the first seconds on a blank frame while the audio
  // plays; the mouth then turns up mid-sentence, indistinguishable from broken
  // lip-sync. Measured 3.5s black on the first case of a fresh page load, and
  // fine on later cases in the same batch, which is what makes it easy to miss.
  // Gating on pixels rather than a load event because only the canvas knows it
  // rendered; relies on the `preserveDrawingBuffer` glb-avatar.tsx already sets.
  window.__canvasReady = async (timeoutMs = 30000) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return false;
    const probe = document.createElement("canvas");
    probe.width = probe.height = 64;
    const g = probe.getContext("2d");
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      g.drawImage(canvas, 0, 0, probe.width, probe.height);
      const px = g.getImageData(0, 0, probe.width, probe.height).data;
      let min = 255, max = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] < min) min = px[i];
        if (px[i] > max) max = px[i];
      }
      if (max - min > 20) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  window.__record = async (id, dir) => {
    // A timed-out case is not just one lost video: its /tts is still in flight,
    // and when it lands the app queues the media, so a *later* case records the
    // abandoned utterance instead of its own -- silently, at a plausible
    // duration. Refuse to continue rather than poison the corpus.
    if (window.__poisoned) {
      return { id, error: `harness poisoned by ${window.__poisoned}; reload the page and start over` };
    }
    if (!(await window.__canvasReady())) return { id, error: "avatar never rendered" };
    const fixture = await window.__nativeFetch(`${EVAL}/fixture?id=${id}`).then((r) => r.json());
    window.__fixture = dir === "reference" ? fixture : null;
    window.__speak = dir === "reference" ? null : fixture.text;
    const armed = { id };
    window.__armed = armed;
    const before = window.__audioSeq || 0;
    window.__rec.onresult({ results: { 0: [{ transcript: fixture.text }] } });

    const done = () => { window.__armed = window.__fixture = window.__speak = null; };
    const t0 = Date.now();
    while ((window.__audioSeq || 0) === before) {
      if (Date.now() - t0 > 40000) { window.__poisoned = id; done(); return { id, error: "no audio produced" }; }
      await new Promise((r) => setTimeout(r, 40));
    }
    if (armed.error) { done(); return { id, error: armed.error }; }
    const audio = window.__lastAudio;
    await new Promise((r) => { audio.addEventListener("ended", r, { once: true }); setTimeout(r, 45000); });
    await new Promise((r) => setTimeout(r, 500)); // let the last frames land
    armed.rec.stop();
    await armed.stopped;
    // A canvas capture stream keeps pulling frames until its track is stopped,
    // so leaking them costs later captures their frame rate: across ten
    // back-to-back cases the last fell to 9fps and convert-captures rejected it.
    armed.release();
    const blob = new Blob(armed.chunks, { type: "video/webm" });
    const res = await window.__nativeFetch(`${EVAL}/upload?dir=${dir}&name=${id}.webm`, { method: "POST", body: blob });
    done();
    return { id, seconds: +audio.duration.toFixed(2), bytes: blob.size, upload: res.status };
  };
  return "installed";
}

function micOn() {
  const mic = [...document.querySelectorAll("button")]
    .find((b) => [...b.querySelectorAll("svg")].some((s) => /Mic/.test(s.getAttribute("data-testid") || "")));
  if (!mic) throw new Error("mic button not found");
  mic.click();
}

const record = (id, dir) => window.__record(id, dir);

/** Record a whole corpus back to back. */
async function recordAll(ids, dir) {
  const out = [];
  for (const id of ids) {
    out.push(await record(id, dir));
    await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}
