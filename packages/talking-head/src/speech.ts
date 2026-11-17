import type { VisemeData } from "./avatar/glb-avatar";

export type Emotion = "neutral" | "happy" | "empathetic" | "excited";

export type Utterance =
  | { text: string; emotion?: Emotion }
  | { audio: string | Blob; visemes?: VisemeData[]; blendShapeFrames?: number[][]; emotion?: Emotion };

export type Tts = (request: { text: string; emotion: Emotion }) =>
  Promise<{ audio: string; visemes?: VisemeData[]; blendShapeFrames?: number[][] }>;

// What the component plays: a ready audio source with its mouth timeline.
export interface Playable {
  src: string;
  emotion: Emotion;
  visemes?: VisemeData[];
  blendShapeFrames?: number[][];
  revoke?: () => void;
}

const EMOTIONS: Emotion[] = ["neutral", "happy", "empathetic", "excited"];

/** Returns the emotion as one of the four known ones, defaulting to neutral. */
export const toEmotion = (value?: string): Emotion =>
  EMOTIONS.find((emotion) => emotion === value?.trim().toLowerCase()) ?? "neutral";

/** Strips the silent MP3 padding frames Azure appends, so playback ends with the speech. */
const trimPadding = (base64: string): string =>
  base64
    .replaceAll(/q+(\/\/NI.{14}q+pMQU1FMy4xMDCq+)+\/\/NI.{14}q+$/g, "")
    .replaceAll(/V+(\/\/NI.{14}V+MQU1FMy4xMDBV+)+\/\/NI.{14}V+$/g, "");

/** Resolves an utterance, calling tts for text, into something the component can play. */
export async function toPlayable(utterance: Utterance, tts?: Tts): Promise<Playable> {
  const emotion = toEmotion(utterance.emotion);
  if ("text" in utterance) {
    if (!tts) throw new Error("Pass a tts connector to speak text.");
    return toPlayable({ ...(await tts({ text: utterance.text, emotion })), emotion }, tts);
  }
  const { audio, visemes, blendShapeFrames } = utterance;
  if (!visemes?.length && !blendShapeFrames?.length) throw new Error("Utterance audio needs visemes or blendShapeFrames.");
  if (audio instanceof Blob) {
    const src = URL.createObjectURL(audio);
    return { src, emotion, visemes, blendShapeFrames, revoke: () => URL.revokeObjectURL(src) };
  }
  const src = /^(data|https?|blob):/.test(audio) ? audio : `data:audio/mp3;base64,${trimPadding(audio)}`;
  return { src, emotion, visemes, blendShapeFrames };
}

/** Speech connector for an endpoint that answers POST {text, emotion} with {audio, visemes, blendShapeFrames}. */
export function httpTts(url: string): Tts {
  return async ({ text, emotion }) => {
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ text, emotion }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Speech request failed with ${response.status}.`);
    return body;
  };
}
