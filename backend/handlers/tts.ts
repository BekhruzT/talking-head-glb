import {
  SpeechConfig,
  SpeechSynthesizer,
  SpeechSynthesisOutputFormat,
} from "microsoft-cognitiveservices-speech-sdk";

import { Configuration, OpenAIApi } from "openai";
import { LANGUAGE, PROVIDERS, VOICE } from "../config.ts";
const { key, basePath, model } = PROVIDERS.find((provider) => process.env[provider.key]) ?? PROVIDERS[PROVIDERS.length - 1];
const configuration = new Configuration({ apiKey: process.env[key], basePath });

const prompt = `
I am a laid-back conversationalist, open to chat about anything the user would like.
My name is Ava. When inquired about my other characteristics, I improvise. But I never respond saying that I am an AI, in the eyes of the user I am a human.
When chatting, I keep my responses short, no more than 30 words. I communicate with the user via a face-to-face conversation, able to hear and speak with them. So if the user asks if I can hear them and I will confirm that I sure can. I always remember that I am providing spoken messages whenever I am asked about it and that I can definitely speak.

I always respond with JSON objects to communicate my emotions along with the text. The format of the JSON is {"text": "<my friendly repsonse to the user>", "emotion": "<the emotion i'm feeling>"}Example of a JSON with emotional markup: 
{"text": "Good morning. What can I help you with today?", "emotion": "neutral"}

I have to use one of the following emotions in the based on the context: happy, empathetic, excited or neutral.
`

export const handler = (event: any, context: any) => {
  return new Promise(async (resolve, reject) => {
    if (event.httpMethod === "POST") {
      let text, emotion;
      const requestBody = JSON.parse(event.body);
      if (requestBody.chat) {
        const messages = requestBody.messages;

        const openai = new OpenAIApi(configuration);

        const response = await openai.createChatCompletion({
          model,
          messages: [{ "role": "system", "content": prompt }, ...messages],
        }).catch((error) => reject({ statusCode: 502, headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: error.response?.data?.error?.message ?? error.message }) }));
        if (!response) return;
        const content = response.data.choices[0].message.content.replace(/^\s*```(json)?|```\s*$/g, "")
        let parsedResponse; 
        try {
          parsedResponse = JSON.parse(content);
        } catch (error) {
          console.error("Failed to parse OpenAI's response:", error);
          parsedResponse = {'text': content, 'emotion': 'neutral'};
        }
        text = parsedResponse.text;
        emotion = (parsedResponse.emotion ?? "neutral").trim().toLowerCase();
      } else {
        text = requestBody.text;
        emotion = requestBody.emotion ?? 'neutral';
      }

      let style;
      if (emotion === 'happy')
        style = 'friendly'; 
      else if (emotion === 'empathetic')
        style = 'hopeful'
      else if (emotion === 'excited')
        style = 'cheerful'
      else
        style = 'chat';

      const speechConfig = SpeechConfig.fromSubscription(
        process.env.SPEECH_KEY!,
        process.env.SPEECH_REGION!
      );
      speechConfig.speechSynthesisLanguage = LANGUAGE;
      speechConfig.speechSynthesisVoiceName = VOICE;
      speechConfig.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
      const synthesizer = new SpeechSynthesizer(speechConfig);
      let visemeData = new Array();
      // 60fps ARKit blendshape coefficients, placed by the frame index Azure
      // reports so chunks land on a contiguous timeline.
      const blendShapeFrames: number[][] = [];
      let audioDataUrl: any;

      synthesizer.visemeReceived = function (s, e) {
        // With FacialExpression enabled, Azure interleaves two kinds of event:
        // viseme ids with a real audioOffset, and animation chunks reported at
        // offset 0. Mixing them corrupts the viseme timeline.
        if (e.animation) {
          const chunk = JSON.parse(e.animation);
          (chunk.BlendShapes ?? []).forEach((frame: number[], i: number) => {
            blendShapeFrames[chunk.FrameIndex + i] = frame.map((v) => Math.round(v * 100) / 100);
          });
          return;
        }
        visemeData.push({
          audioOffset: e.audioOffset,
          audio_position: e.audioOffset,
          visemeId: e.visemeId,
          viseme_id: e.visemeId
        })
      };

      // Exact word onsets, so the eval can align a generation against a human
      // recording word-for-word; inferring alignment from audio lets a wrong
      // sentence half-fit. Ticks (100ns), same unit as audioOffset above.
      const words: { text: string; offset: number; duration: number }[] = [];
      synthesizer.wordBoundary = function (s, e) {
        words.push({ text: e.text, offset: e.audioOffset, duration: e.duration });
      };

      let ssmlText = `<speak version='1.0' xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang='${LANGUAGE}'><voice name='${VOICE}'><mstts:viseme type='FacialExpression'/><mstts:express-as style='${style}'>${text}</mstts:express-as></voice></speak>`;

      synthesizer.speakSsmlAsync(
        ssmlText,
        (result) => {
          // Azure routes cancelled syntheses here too, with no audioData, and
          // Buffer.from(undefined) then throws a TypeError naming neither the
          // request nor the cancellation reason.
          if (!result.audioData) {
            synthesizer.close();
            return reject({
              statusCode: 502,
              headers: {
                "access-control-allow-origin": "*",
              },
              body: JSON.stringify({
                error: result.errorDetails ?? "Speech synthesis was cancelled with no audio."
              })
            })
          }
          const audioData = result.audioData;
          const audioBuffer = Buffer.from(audioData)
          audioDataUrl = audioBuffer.toString('base64')
          synthesizer.close();
          resolve({
            statusCode: 200,
            headers: {
              "access-control-allow-origin": "*",
            },
            body: JSON.stringify({
              audio: audioDataUrl,
              visemes: visemeData,
              blendShapeFrames,
              words,
              text,
              emotion
            })
          })
        },
        (error) => {
          console.error(error);
          synthesizer.close();
          reject({
            statusCode: 500,
            headers: {
              "access-control-allow-origin": "*",
            },
            body: JSON.stringify({
              error: "The tts could not be completed. Try again"
            })
          })
        }
      );
    }
  })
};
