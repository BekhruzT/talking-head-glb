import { AZURE_BLENDSHAPE_NAMES, SPEECH_CHANNEL_NAMES, normalizeFrames, sampleFrame } from "./blendshape-stream";
import { blendShapeIndices } from "./animations";

const frames = [
  [0, 0, 0],
  [1, 0.5, 0],
  [0, 1, 0],
];

test("channel order matches what the probe saw on the wire", () => {
  expect(AZURE_BLENDSHAPE_NAMES).toHaveLength(55);
  expect(AZURE_BLENDSHAPE_NAMES[17]).toBe("jawOpen");
  expect(AZURE_BLENDSHAPE_NAMES[18]).toBe("mouthClose");
  expect(AZURE_BLENDSHAPE_NAMES[37]).toBe("mouthLowerDownLeft");
});

test("every speech channel exists on the rig", () => {
  expect(SPEECH_CHANNEL_NAMES).toContain("jawOpen");
  for (const name of SPEECH_CHANNEL_NAMES) {
    expect(blendShapeIndices).toHaveProperty(name);
  }
});

test("speech channels leave the eyes and brows to the expression system", () => {
  for (const name of SPEECH_CHANNEL_NAMES) {
    expect(name).not.toMatch(/^(eye|brow|nose)/);
  }
});

test("closes the mouth on silent frames instead of leaving it hanging open", () => {
  // jawOpen as measured on the wire: 0.19 through silence, 0.38 on a wide "aah".
  const silent = 0.19;
  const [rest, mid, peak] = normalizeFrames([[silent], [0.28], [0.38]]);
  expect(rest[0]).toBe(0);
  // and the speech that rode on top survives 1:1
  expect(mid[0]).toBeCloseTo(0.09);
  expect(peak[0]).toBeCloseTo(0.19);
});

test("funnel/pucker pedestal is swallowed but real rounding survives", () => {
  const FUNNEL = AZURE_BLENDSHAPE_NAMES.indexOf("mouthFunnel");
  const restFrame = new Array(55).fill(0);
  const pedestal = new Array(55).fill(0);
  pedestal[FUNNEL] = 0.1; // Azure's constant slight funnel through neutral speech
  const rounded = new Array(55).fill(0);
  rounded[FUNNEL] = 0.4; // an actual "o"
  const [, ped, o] = normalizeFrames([restFrame, pedestal, rounded]);
  expect(ped[FUNNEL]).toBe(0);
  expect(o[FUNNEL]).toBeCloseTo((0.4 - 0.12) * 1.4);
});

test("normalizing never drives a morph target out of range", () => {
  const [, loud] = normalizeFrames([[0.1, 0.5], [0.9, 0.5]], 10);
  expect(loud[0]).toBe(1);
  expect(loud[1]).toBe(0);
  expect(normalizeFrames([], 2.5)).toEqual([]);
});

test("samples the frame at a position on the audio timeline", () => {
  expect(sampleFrame(frames, 0)).toEqual([0, 0, 0]);
  // 1/60s per frame, so 1000/60 ms lands exactly on frame 1
  expect(sampleFrame(frames, 1000 / 60)).toEqual([1, 0.5, 0]);
});

test("interpolates between frames instead of stepping", () => {
  const mid = sampleFrame(frames, 1000 / 60 / 2)!;
  expect(mid[0]).toBeCloseTo(0.5);
  expect(mid[1]).toBeCloseTo(0.25);
});

test("reports nothing to play before playback, after the end, and when empty", () => {
  expect(sampleFrame(frames, Infinity)).toBeNull();
  expect(sampleFrame(frames, -1)).toBeNull();
  expect(sampleFrame(frames, 1000)).toBeNull();
  expect(sampleFrame([], 0)).toBeNull();
});
