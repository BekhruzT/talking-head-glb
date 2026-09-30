// Eval helper server, localhost only:
//   GET  /fixture?id=case01      canned /tts response built from a BEAT clip
//   POST /upload?name=x&dir=y    write a MediaRecorder blob under eval/
//   GET  /<path>                 static files from eval/ (compare.html, videos)
// ponytail: throwaway eval tool, no auth.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, normalize, basename } from "node:path";

const PORT = 4100;
const ROOT = join(import.meta.dirname, ".."); // eval/
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const TYPES = { html: "text/html", js: "text/javascript", json: "application/json", mp4: "video/mp4", webm: "video/webm" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/upload") {
    const requested = url.searchParams.get("dir") ?? "";
    const dir = ["reference", "generation"].includes(requested) ? requested : ".";
    const name = basename(url.searchParams.get("name") ?? "capture.webm");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const file = join(ROOT, dir, name);
      const data = Buffer.concat(chunks);
      await writeFile(file, data);
      console.log(`saved ${file} (${data.length} bytes)`);
      res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(JSON.stringify({ saved: file, bytes: data.length }));
    });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    // Case ids are unique across corpora (case01.. vs etf01..), so /fixture can
    // just look in both rather than making callers name the corpus.
    const id = basename(url.searchParams.get("id") ?? "");
    const rel =
      url.pathname === "/fixture"
        ? ["inputs", "inputs2"].map((c) => `${c}/${id}/fixture.json`).find((p) => existsSync(join(ROOT, p)))
          ?? `inputs/${id}/fixture.json`
        : url.pathname === "/"
          ? "compare.html"
          : url.pathname.slice(1);
    const file = join(ROOT, normalize(rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403, CORS).end();
      return;
    }
    try {
      const data = await readFile(file);
      const type = TYPES[file.split(".").pop()] ?? "application/octet-stream";
      res.writeHead(200, { ...CORS, "content-type": type });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404, CORS).end();
    }
    return;
  }
  res.writeHead(404, CORS).end();
}).listen(PORT, () => console.log(`eval server on http://localhost:${PORT}`));
