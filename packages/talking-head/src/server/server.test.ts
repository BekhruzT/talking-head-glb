// @vitest-environment node
import { ssml } from "./index.ts";

test.each([
  ["happy", "friendly"],
  ["empathetic", "hopeful"],
  ["excited", "cheerful"],
  ["neutral", "chat"],
])("%s speaks in the %s style", (emotion, style) => {
  expect(ssml({ text: "Hi", emotion })).toContain(`<mstts:express-as style='${style}'>Hi</mstts:express-as>`);
});

test("text is XML-escaped inside the SSML", () => {
  const out = ssml({ text: "Tom & <Jerry>" });
  expect(out).toContain(">Tom &#38; &#60;Jerry&#62;</mstts:express-as>");
  expect(out).not.toContain("<Jerry>");
});

test("voice and language default to Jenny in en-US and can be overridden", () => {
  expect(ssml({ text: "Hi" })).toMatch(/xml:lang='en-US'><voice name='en-US-JennyNeural'>/);
  expect(ssml({ text: "Hi" }, { voice: "en-GB-SoniaNeural", language: "en-GB" })).toMatch(/xml:lang='en-GB'><voice name='en-GB-SoniaNeural'>/);
});
