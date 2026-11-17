import { SpeechConfig, SpeechSynthesisOutputFormat, SpeechSynthesizer } from "microsoft-cognitiveservices-speech-sdk";
import type { VisemeData } from "../avatar/glb-avatar";
import { toEmotion, type Emotion } from "../speech.ts";

export interface SpeechResult { audio: string; visemes: VisemeData[]; blendShapeFrames: number[][]; words: { text: string; offset: number; duration: number }[] }
export interface SpeechOptions { key: string; region: string; voice?: string; language?: string }

const STYLE: Record<Emotion, string> = { happy: "friendly", empathetic: "hopeful", excited: "cheerful", neutral: "chat" };
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The SSML for one utterance: Azure's facial-expression visemes in the emotion's speaking style. */
export function ssml({ text, emotion }: { text: string; emotion?: string }, { voice = "en-US-JennyNeural", language = "en-US" }: Partial<SpeechOptions> = {}) {
  return `<speak version='1.0' xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang='${escapeXml(language)}'><voice name='${escapeXml(voice)}'><mstts:viseme type='FacialExpression'/><mstts:express-as style='${STYLE[toEmotion(emotion)]}'>${escapeXml(text)}</mstts:express-as></voice></speak>`;
}

/** Speaks text with Azure, returning base64 mp3 audio with its viseme, blendshape and word timelines. */
export function synthesize(request: { text: string; emotion?: string }, options: SpeechOptions): Promise<SpeechResult> {
  const config = SpeechConfig.fromSubscription(options.key, options.region);
  config.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
  const synthesizer = new SpeechSynthesizer(config);
  const visemes: VisemeData[] = [];
  // 60fps ARKit blendshape coefficients, placed by the frame index Azure reports so chunks land on a contiguous timeline.
  const blendShapeFrames: number[][] = [];
  // Exact word onsets in ticks (100ns), the same unit as audioOffset.
  const words: SpeechResult["words"] = [];

  synthesizer.visemeReceived = (_, e) => {
    // With FacialExpression enabled, Azure interleaves viseme ids (real audioOffset) with animation chunks at offset 0.
    if (e.animation) {
      const chunk = JSON.parse(e.animation);
      (chunk.BlendShapes ?? []).forEach((frame: number[], i: number) => {
        blendShapeFrames[chunk.FrameIndex + i] = frame.map((v) => Math.round(v * 100) / 100);
      });
      return;
    }
    visemes.push({ audioOffset: e.audioOffset, audio_position: e.audioOffset, visemeId: e.visemeId, viseme_id: e.visemeId } as VisemeData);
  };
  synthesizer.wordBoundary = (_, e) => {
    words.push({ text: e.text, offset: e.audioOffset, duration: e.duration });
  };

  return new Promise((resolve, reject) => {
    synthesizer.speakSsmlAsync(
      ssml(request, options),
      (result) => {
        synthesizer.close();
        // Azure routes cancelled syntheses here too, with no audioData.
        if (!result.audioData) return reject(new Error(result.errorDetails ?? "Speech synthesis was cancelled with no audio."));
        resolve({ audio: Buffer.from(result.audioData).toString("base64"), visemes, blendShapeFrames, words });
      },
      (error) => {
        synthesizer.close();
        reject(new Error(String(error)));
      },
    );
  });
}
