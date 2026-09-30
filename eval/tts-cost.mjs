// What one utterance costs on Azure TTS, measured against this repo's own SSML
// and corpus rather than a generic per-character estimate.
//
// Azure bills every character in the SSML body except the <speak> and <voice>
// tags -- markup included. See "Billable characters" in
// learn.microsoft.com/azure/ai-services/speech-service/text-to-speech
//
//   node eval/tts-cost.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const EVAL = import.meta.dirname;
const RATE_PER_M = 16; // USD per 1M chars, prebuilt neural, pay-as-you-go

// Exactly the envelope backend/handlers/tts.ts builds.
const VISEME = "<mstts:viseme type='FacialExpression'/>";
const styleTags = (s) => `<mstts:express-as style='${s}'>` + "</mstts:express-as>";
const STYLES = { neutral: "chat", happy: "friendly", empathetic: "hopeful", excited: "cheerful" };

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => sum(a) / a.length;
const usd = (n) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

console.log("Billed markup per request (speak/voice tags are exempt):");
console.log(`  viseme tag                 ${VISEME.length} chars`);
for (const [emotion, style] of Object.entries(STYLES)) {
  console.log(`  express-as ${style.padEnd(9)}      ${styleTags(style).length} chars   (emotion: ${emotion})`);
}
const overhead = VISEME.length + styleTags("chat").length;
console.log(`  total, neutral utterance   ${overhead} chars\n`);

const dur = (f) =>
  +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim();

const rows = [];
for (const corpus of ["inputs", "inputs2"]) {
  const dir = join(EVAL, corpus);
  if (!existsSync(dir)) continue;
  for (const id of readdirSync(dir)) {
    const f = join(dir, id, "fixture.json");
    if (!existsSync(f)) continue;
    const text = JSON.parse(readFileSync(f, "utf8")).text;
    if (!text) continue;
    const mp4 = join(EVAL, "generation", `${id}.mp4`);
    rows.push({
      corpus, id,
      chars: text.length,
      words: text.trim().split(/\s+/).length,
      seconds: existsSync(mp4) ? dur(mp4) : null,
    });
  }
}

for (const corpus of ["inputs", "inputs2"]) {
  const r = rows.filter((x) => x.corpus === corpus);
  if (!r.length) continue;
  const chars = r.map((x) => x.chars);
  console.log(
    `${corpus}: n=${r.length}  text ${Math.round(mean(chars))} chars avg ` +
      `(${Math.min(...chars)}-${Math.max(...chars)})  ${Math.round(mean(r.map((x) => x.words)))} words avg`
  );
  const timed = r.filter((x) => x.seconds);
  if (timed.length) {
    const cps = mean(timed.map((x) => x.chars / x.seconds));
    console.log(
      `  spoken at ${cps.toFixed(1)} chars/sec  ->  ${(cps * 60).toFixed(0)} billed text chars per minute of speech`
    );
    // Overhead is per request, so its weight depends on utterance length.
    const billed = mean(timed.map((x) => x.chars + overhead));
    console.log(
      `  avg billed/request ${billed.toFixed(0)} chars = ${usd((billed / 1e6) * RATE_PER_M)}  ` +
        `(markup is ${((overhead / billed) * 100).toFixed(0)}% of it)`
    );
    console.log(`  cost per minute of speech ${usd(((cps * 60 + overhead) / 1e6) * RATE_PER_M)}`);
  }
}

// The chat path caps replies at 30 words; that, not the corpus, is production shape.
console.log("\nProduction shape (prompt caps replies at 30 words, ~150 chars):");
for (const n of [150]) {
  const billed = n + overhead;
  console.log(`  ${n} chars text + ${overhead} markup = ${billed} billed = ${usd((billed / 1e6) * RATE_PER_M)}/reply`);
  console.log(`  free tier (500k chars/mo) covers ${Math.floor(5e5 / billed).toLocaleString()} replies/month`);
  for (const perDay of [1e3, 1e4, 1e5]) {
    const monthly = ((perDay * 30 * billed) / 1e6) * RATE_PER_M;
    console.log(`  ${perDay.toLocaleString().padStart(7)} replies/day -> ${usd(monthly).padStart(10)}/mo`);
  }
}
