// Downloads the 20 BEAT clips (speaker 9, miranda) that make up the eval
// corpus, one inputs/caseNN folder per clip.
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BASE =
  "https://huggingface.co/datasets/H-Liu1997/BEAT/resolve/main/beat_english_v0.2.1/beat_english_v0.2.1/9";
// Hand-curated conversation sessions: the first ~12s of each was checked for
// clean, coherent text (no garbled ASR, no mid-sentence restarts).
const SESSIONS = [1, 9, 11, 16, 18, 21, 23, 28, 31, 37, 45, 48, 49, 51, 53, 58, 61, 71, 82, 98];
export const CLIPS = SESSIONS.map((n) => `9_miranda_0_${n}_${n}`);

export const caseId = (i) => `case${String(i + 1).padStart(2, "0")}`;
export const caseDir = (i) => join(import.meta.dirname, caseId(i));

if (process.argv[1]?.includes("download-corpus")) {
  for (let i = 0; i < CLIPS.length; i++) {
    const clip = CLIPS[i];
    mkdirSync(caseDir(i), { recursive: true });
    for (const ext of ["json", "wav", "TextGrid"]) {
      const out = join(caseDir(i), `${clip}.${ext}`);
      if (existsSync(out) && statSync(out).size > 0) continue;
      const res = await fetch(`${BASE}/${clip}.${ext}`);
      if (!res.ok) {
        console.error(`FAILED ${clip}.${ext}: ${res.status}`);
        continue;
      }
      await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
      console.log(`ok ${clip}.${ext}`);
    }
  }
  console.log("corpus download done");
}
