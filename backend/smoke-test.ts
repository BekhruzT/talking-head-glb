import assert from "node:assert/strict";

// Checks the one route the GLB avatar depends on: OpenAI reply -> Azure TTS ->
// audio + viseme stream. Run `npm run dev` first, then `npm run smoke`.
const ENDPOINT = process.env.TTS_ENDPOINT ?? "http://localhost:4000/tts";

const res = await fetch(ENDPOINT, {
  method: "POST",
  body: JSON.stringify({ chat: true, messages: [{ role: "user", content: "Hi, can you hear me?" }] }),
});
const raw = await res.text();
assert.equal(res.status, 200, `expected 200, got ${res.status}: ${raw}`);

const { audio, visemes, blendShapeFrames, text, emotion } = JSON.parse(raw);

assert.ok(text?.length, "no text from the LLM");
assert.ok(
  ["happy", "empathetic", "excited", "neutral"].includes(emotion),
  `emotion "${emotion}" is not one the avatar maps to an expression`
);

// An MP3 the browser can play: the frontend prefixes this with a data: URL.
const audioBytes = Buffer.from(audio, "base64");
assert.ok(audioBytes.length > 1000, `audio too small to be speech (${audioBytes.length} bytes)`);

// Lip-sync is driven entirely by these; ids outside 0-21 have no blendshape.
assert.ok(visemes.length > 5, `expected a viseme stream, got ${visemes.length}`);
assert.ok(
  visemes.every((v: any) => v.visemeId >= 0 && v.visemeId <= 21),
  "viseme id outside the 0-21 range the blendshape map covers"
);
assert.ok(
  visemes.every((v: any, i: number) => i === 0 || v.audioOffset >= visemes[i - 1].audioOffset),
  "viseme offsets are not monotonic, lip-sync timing would jump"
);

// The avatar samples these at 60fps against the audio clock, so a gap would
// freeze the face mid-utterance.
const spokenMs = visemes.at(-1).audioOffset / 10000;
assert.ok(blendShapeFrames.length > 0, "no blendshape stream returned");
assert.ok(
  blendShapeFrames.every((f: number[]) => f && f.length === 55),
  "blendshape frame missing or not 55 coefficients wide"
);
const streamMs = (blendShapeFrames.length / 60) * 1000;
assert.ok(
  streamMs >= spokenMs && streamMs - spokenMs < 2000,
  `blendshape stream (${Math.round(streamMs)}ms) does not cover the speech (${Math.round(spokenMs)}ms)`
);

console.log(`ok  "${text}" (${emotion})`);
console.log(`ok  ${audioBytes.length} bytes mp3, ${visemes.length} visemes over ${(spokenMs / 1000).toFixed(2)}s`);
console.log(`ok  ${blendShapeFrames.length} blendshape frames, ${(raw.length / 1024).toFixed(0)}KB payload total`);
