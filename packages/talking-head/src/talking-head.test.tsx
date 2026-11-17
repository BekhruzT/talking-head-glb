import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { TalkingHead } from "./talking-head";
import { httpTts } from "./speech";
import greeting from "../../../backend/eval-fixtures/greeting.json";

vi.mock("./avatar", () => ({
  Avatar: ({ src, status, visemes, blendShapeFrames }: { src: string; status: number; visemes?: unknown[]; blendShapeFrames?: unknown[] }) => (
    <div data-testid="avatar" data-src={src} data-status={status} data-visemes={visemes?.length ?? 0} data-frames={blendShapeFrames?.length ?? 0} />
  ),
}));

class FakeAudio {
  static played: FakeAudio[] = [];
  muted = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public src: string) {}
  play() { FakeAudio.played.push(this); return Promise.resolve(); }
  pause() {}
}

const fixture = { audio: "SUQz", visemes: greeting.visemes as any, blendShapeFrames: greeting.frames as number[][] };
const avatar = () => screen.getByTestId("avatar");
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  FakeAudio.played = [];
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => vi.unstubAllGlobals());

test("ready-made audio with a real fixture's visemes and frames plays without calling tts", async () => {
  const tts = vi.fn();
  render(<TalkingHead head="/ava.glb" speech={{ ...fixture, emotion: "happy" }} tts={tts} />);
  await flush();
  expect(tts).not.toHaveBeenCalled();
  expect(FakeAudio.played.map((audio) => audio.src)).toEqual(["data:audio/mp3;base64,SUQz"]);
  expect(avatar()).toHaveAttribute("data-visemes", String(greeting.visemes.length));
  expect(avatar()).toHaveAttribute("data-frames", String(greeting.frames.length));
  expect(avatar()).toHaveAttribute("data-status", "2");
});

test("StrictMode's effect replay speaks the first utterance once", async () => {
  render(<StrictMode><TalkingHead head="/ava.glb" speech={fixture} /></StrictMode>);
  await flush();
  act(() => FakeAudio.played[0].onended?.());
  await flush();
  expect(FakeAudio.played).toHaveLength(1);
});

test("text calls tts once with neutral emotion and plays its result", async () => {
  const tts = vi.fn().mockResolvedValue(fixture);
  render(<TalkingHead head="/ava.glb" speech={{ text: "Hello there" }} tts={tts} />);
  await flush();
  expect(tts).toHaveBeenCalledTimes(1);
  expect(tts).toHaveBeenCalledWith({ text: "Hello there", emotion: "neutral" });
  expect(FakeAudio.played).toHaveLength(1);
});

test.each([
  [{ audio: "SUQz" }, "Utterance audio needs visemes or blendShapeFrames."],
  [{ text: "Hi" }, "Pass a tts connector to speak text."],
])("an unplayable utterance reports an error and plays nothing: %o", async (speech, message) => {
  const onError = vi.fn();
  render(<TalkingHead head="/ava.glb" speech={speech} onError={onError} />);
  await flush();
  expect(onError).toHaveBeenCalledWith(new Error(message));
  expect(FakeAudio.played).toHaveLength(0);
  expect(avatar()).toHaveAttribute("data-status", "0");
});

test("utterances play in the order given, even when the first waits on tts", async () => {
  let answer!: (value: typeof fixture) => void;
  const tts = vi.fn(() => new Promise<typeof fixture>((resolve) => { answer = resolve; }));
  const { rerender } = render(<TalkingHead head="/ava.glb" speech={{ text: "first" }} tts={tts} />);
  rerender(<TalkingHead head="/ava.glb" speech={{ ...fixture, audio: "U0VDT05E" }} tts={tts} />);
  await flush();
  expect(FakeAudio.played).toHaveLength(0);
  answer({ ...fixture, audio: "RklSU1Q=" });
  await flush();
  expect(FakeAudio.played.map((audio) => audio.src)).toEqual(["data:audio/mp3;base64,RklSU1Q="]);
  act(() => FakeAudio.played[0].onended?.());
  await flush();
  expect(FakeAudio.played.map((audio) => audio.src.slice(-8))).toEqual(["RklSU1Q=", "U0VDT05E"]);
});

test("onSpeakingChange reports true when speech starts and false when it ends, not on mount", async () => {
  const onSpeakingChange = vi.fn();
  const { rerender } = render(<TalkingHead head="/ava.glb" onSpeakingChange={onSpeakingChange} />);
  expect(onSpeakingChange).not.toHaveBeenCalled();
  rerender(<TalkingHead head="/ava.glb" speech={fixture} onSpeakingChange={onSpeakingChange} />);
  await flush();
  act(() => FakeAudio.played[0].onended?.());
  await flush();
  expect(onSpeakingChange.mock.calls).toEqual([[true], [false]]);
});

test("muted mutes the playing element and unmuting restores it", async () => {
  const { rerender } = render(<TalkingHead head="/ava.glb" speech={fixture} muted />);
  await flush();
  expect(FakeAudio.played[0].muted).toBe(true);
  rerender(<TalkingHead head="/ava.glb" speech={fixture} muted={false} />);
  expect(FakeAudio.played[0].muted).toBe(false);
});

test("httpTts posts the text and emotion and rejects with the server's error", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => fixture })
    .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "Speech synthesis was cancelled with no audio." }) });
  vi.stubGlobal("fetch", fetch);
  const tts = httpTts("http://localhost:4000/tts");
  await expect(tts({ text: "Hi", emotion: "happy" })).resolves.toEqual(fixture);
  expect(fetch).toHaveBeenCalledWith("http://localhost:4000/tts", { method: "POST", body: JSON.stringify({ text: "Hi", emotion: "happy" }) });
  await expect(tts({ text: "Hi", emotion: "neutral" })).rejects.toThrow("Speech synthesis was cancelled with no audio.");
});
