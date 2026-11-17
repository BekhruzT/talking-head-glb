/**
 * Azure's FacialExpression viseme output: 55 coefficients per frame at 60fps.
 * The first 52 are the ARKit blendshapes in their canonical order, which is
 * also the order the GLB's morph targets were authored in; the last three are
 * head roll and eye roll, which this rig has no morph targets for.
 */
export const AZURE_BLENDSHAPE_NAMES = [
  "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
  "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
  "jawForward", "jawLeft", "jawRight", "jawOpen",
  "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "noseSneerLeft", "noseSneerRight", "tongueOut",
  "headRoll", "leftEyeRoll", "rightEyeRoll",
];

/**
 * Channels the speech stream is allowed to drive: the articulators only.
 * Eyes, brows, nose and cheek squint stay with the existing blink / expression
 * / head-movement system, which keeps running on wall time because it is not
 * tied to the voice. Emotion still reaches the mouth, because the stream is
 * synthesised from SSML that already carries the express-as style.
 */
export const SPEECH_CHANNEL_NAMES = AZURE_BLENDSHAPE_NAMES.slice(14, 41).concat("cheekPuff");

export const STREAM_FPS = 60;

/**
 * Azure's coefficients are offsets from its own neutral face, not from a closed
 * mouth. Measured over 1.2s of pure silence (a leading `<break>`): jawOpen sits
 * at 0.19, mouthLowerDown{Left,Right} at 0.22, mouthClose at 0.13. Applied
 * absolutely, that hangs the mouth open between every word, so the per-channel
 * minimum over the utterance is subtracted as the rest pose.
 *
 * Numbers below are from backend/lipsync-eval.ts, which scores candidate
 * transforms on 12 recorded utterances against the old viseme-id scheduler
 * as the baseline. Two findings shaped the constants:
 *
 * - gain: the residual band is narrower than raw ARKit ranges, but boosting it
 *   (2.5) overshot the baseline badly (p90 wide-vowel aperture 0.67 vs the old
 *   system's 0.44, worst case 0.79). Gain 1.0 lands at 0.28/0.33 -- slightly
 *   under the old system, which is the right side to err on.
 * - the "O face": Azure keeps mouthFunnel+mouthPucker at ~0.27 through ALL
 *   speech, while its rounded-vowel signal only reaches ~0.39. A linear gain
 *   can't separate pedestal from signal at a 1.4:1 ratio, so those two
 *   channels get a deadzone instead: drop the first 0.12, restore the peaks
 *   with 1.4x. Pedestal falls 0.67 -> 0.13 while o/u/w rounding survives.
 *
 * ponytail: rest pose is the per-channel minimum, so it self-calibrates to any
 * voice/locale. Ceiling: an utterance whose mouth never returns to neutral has
 * its quietest frame treated as neutral and over-closes slightly. The deadzone
 * knee (0.12/1.4) is calibrated to en-US-JennyNeural fixtures; re-run
 * `node lipsync-eval.ts compare` after switching voices.
 */
export const SPEECH_GAIN = 1.0;
const ROUND_DEADZONE = 0.12;
const ROUND_RESTORE = 1.4;
const ROUND_CHANNELS = new Set([
  AZURE_BLENDSHAPE_NAMES.indexOf("mouthFunnel"),
  AZURE_BLENDSHAPE_NAMES.indexOf("mouthPucker"),
]);

export function normalizeFrames(frames: number[][], gain = SPEECH_GAIN): number[][] {
  if (!frames || frames.length === 0) return frames;
  const rest = frames.reduce((min, f) => min.map((v, i) => Math.min(v, f[i])), frames[0]);
  return frames.map((f) =>
    f.map((v, i) => {
      const r = Math.min(1, (v - rest[i]) * gain);
      return ROUND_CHANNELS.has(i) ? Math.min(1, Math.max(0, r - ROUND_DEADZONE) * ROUND_RESTORE) : r;
    })
  );
}

/**
 * Interpolates the stream at a position on the audio timeline. Returns null
 * when there is nothing to play or the utterance is over, which is the signal
 * to hand the articulators back to the expression system.
 */
export function sampleFrame(frames: number[][], timeMs: number): number[] | null {
  if (!frames || frames.length === 0) return null;
  if (!Number.isFinite(timeMs) || timeMs < 0) return null;

  const pos = (timeMs / 1000) * STREAM_FPS;
  if (pos >= frames.length) return null;

  const i0 = Math.floor(pos);
  const i1 = Math.min(i0 + 1, frames.length - 1);
  const k = pos - i0;
  const a = frames[i0];
  const b = frames[i1];
  return a.map((v, i) => v + (b[i] - v) * k);
}
