import { ambientMotionEnabled, MotionSettings } from "./motion-settings";

test("ambient motion categories can be disabled without affecting the others", () => {
  const settings: MotionSettings = {
    headMovementEnabled: false,
    gazeEnabled: true,
    expressionsEnabled: false,
    blinkingEnabled: true,
  };

  expect(ambientMotionEnabled("HeadDown", settings)).toBe(false);
  expect(ambientMotionEnabled("eyeLookUpLeft", settings)).toBe(true);
  expect(ambientMotionEnabled("browInnerUp", settings)).toBe(false);
  expect(ambientMotionEnabled("eyeBlinkLeft", settings)).toBe(true);
});
