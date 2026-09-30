// How long each capture opens on an empty canvas. The avatar is loaded async, so
// a capture armed before it renders spends its first seconds black while the
// audio plays -- which looks exactly like broken lip-sync.
// node eval/_ab/blank-start.mjs eval/generation/etf01.mp4 ...
import { execFileSync } from "node:child_process";

for (const file of process.argv.slice(2)) {
  const out = execFileSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-t", "6",
    "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

  // metadata=print emits one "frame:N pts_time:T" line then key=value lines.
  let time = 0, min = null, firstContent = null;
  for (const line of out.split("\n")) {
    const t = line.match(/pts_time:([\d.]+)/);
    if (t) { time = +t[1]; min = null; continue; }
    const ymin = line.match(/YMIN=(\d+)/);
    if (ymin) min = +ymin[1];
    const ymax = line.match(/YMAX=(\d+)/);
    if (ymax && min !== null && +ymax[1] - min > 20 && firstContent === null) firstContent = time;
  }
  console.log(`${file.padEnd(34)} avatar visible from ${firstContent === null ? ">6s" : firstContent.toFixed(2) + "s"}`);
}
