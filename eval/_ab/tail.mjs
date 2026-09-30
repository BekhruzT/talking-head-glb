// How much sound is still there after the talking stops -- the one number that
// says whether a room setting is audible at all.
//
// Speech offset is the last 20ms hop above a fraction of the loudest hop, so it
// does not depend on absolute level. Reported relative to speech level, because
// that ratio is what the ear judges: below about -40dB there is nothing to hear.
//
//   node eval/_ab/tail.mjs eval/_ab/seg-dry.mp4 ...
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const RATE = 16000, HOP = 320; // 20ms
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

for (const file of process.argv.slice(2)) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file,
    "-ac", "1", "-ar", String(RATE), "-f", "s16le", "_tail.raw"]);
  const b = readFileSync("_tail.raw");
  const hops = [];
  for (let i = 0; i + HOP <= b.length / 2; i += HOP) {
    let s = 0;
    for (let j = 0; j < HOP; j++) { const v = b.readInt16LE((i + j) * 2) / 32768; s += v * v; }
    hops.push(Math.sqrt(s / HOP));
  }
  unlinkSync("_tail.raw");

  const peak = Math.max(...hops);
  const speech = hops.filter((h) => h > peak * 0.1);
  const level = speech.reduce((s, x) => s + x, 0) / speech.length;
  const offset = hops.findLastIndex((h) => h > peak * 0.1);
  const after = hops.slice(offset + 1, offset + 1 + 12); // 240ms past the last word
  const tail = after.length ? Math.max(...after) : 0;
  // How long it takes to fall 40dB under speech, which is roughly inaudible.
  const decay = after.findIndex((h) => db(h) - db(level) < -40);

  console.log(
    `${file.padEnd(26)} tail ${(db(tail) - db(level)).toFixed(1).padStart(6)}dB under speech   ` +
      `falls quiet after ${decay < 0 ? ">240" : decay * 20}ms`
  );
}
