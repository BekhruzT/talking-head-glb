import { createServer } from "node:http";
import { handler as tts } from "./handlers/tts.ts";

// Local speech endpoint for Ava.
const PORT = Number(process.env.PORT ?? 4000);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST,OPTIONS",
};

for (const key of ["SPEECH_KEY", "SPEECH_REGION", "OPENAI_API_KEY or GEMINI_API_KEY"]) {
  if (!key.split(" or ").some((name) => process.env[name])) {
    console.error(`Missing ${key}. Set it in the repo-root .env file.`);
    process.exit(1);
  }
}

createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  if (req.method !== "POST" || !req.url?.startsWith("/tts")) {
    res.writeHead(404, CORS).end();
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const body = Buffer.concat(chunks).toString();
    try {
      const result: any = await tts({ httpMethod: "POST", body }, {});
      res
        .writeHead(result.statusCode, { ...CORS, "content-type": "application/json" })
        .end(result.body);
    } catch (err: any) {
      console.error("tts failed:", err);
      res
        .writeHead(err?.statusCode ?? 500, { ...CORS, "content-type": "application/json" })
        .end(err?.body ?? JSON.stringify({ error: String(err?.message ?? err) }));
    }
  });
}).listen(PORT, () => console.log(`tts dev server listening on http://localhost:${PORT}`));
