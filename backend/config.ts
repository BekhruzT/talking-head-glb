// Chat providers, all spoken to through the OpenAI chat API; the first whose key is set serves chat.
export const PROVIDERS = [
  { key: "GEMINI_API_KEY", basePath: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite" },
  { key: "OPENAI_API_KEY", basePath: undefined, model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini" },
];

export const VOICE = "en-US-JennyNeural";
export const LANGUAGE = "en-US";
