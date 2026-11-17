import { lipsyncTime } from "./lipsync-clock";

test("holds at the start of the timeline until playback actually begins", () => {
  // new Audio(...) then play(): paused, decoding, nothing audible yet.
  expect(lipsyncTime({ currentTime: 0, ended: false })).toBe(0);
});

test("tracks the media clock rather than elapsed wall time", () => {
  expect(lipsyncTime({ currentTime: 1.234, ended: false })).toBeCloseTo(1234);
  expect(lipsyncTime({ currentTime: 7.35, ended: false })).toBeCloseTo(7350);
});

test("flushes animations still queued when the utterance ends", () => {
  expect(lipsyncTime({ currentTime: 7.35, ended: true })).toBe(Infinity);
  expect(lipsyncTime(null)).toBe(Infinity);
});
