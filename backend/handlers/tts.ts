import { Configuration, OpenAIApi } from "openai";
import { synthesize } from "talking-head-glb/server";
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

      synthesize({ text, emotion }, { key: process.env.SPEECH_KEY!, region: process.env.SPEECH_REGION!, voice: VOICE, language: LANGUAGE })
        .then((speech) => resolve({ statusCode: 200, headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ...speech, text, emotion }) }))
        .catch((error: Error) => {
          console.error(error);
          reject({ statusCode: 502, headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: error.message }) });
        });
    }
  })
};
