export interface MotionSettings {
  headMovementEnabled: boolean;
  gazeEnabled: boolean;
  expressionsEnabled: boolean;
  blinkingEnabled: boolean;
}

export function motionChannel(shape: string): keyof MotionSettings {
  if (/^(Head|Trun)/.test(shape)) return "headMovementEnabled";
  if (shape.startsWith("eyeLook")) return "gazeEnabled";
  if (shape.startsWith("eyeBlink")) return "blinkingEnabled";
  return "expressionsEnabled";
}

export function ambientMotionEnabled(shape: string, settings: MotionSettings): boolean {
  return settings[motionChannel(shape)];
}
