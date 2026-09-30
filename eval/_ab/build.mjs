// Builds one A/B clip so the room can be judged by ear: same utterance three
// times, labelled, with a black gap between so the ear resets. Two things keep
// it measuring the room rather than the capture. Canvas captures are
// variable-rate (7-29fps depending on real window focus) and a choppier segment
// reads as worse lip-sync, so sources are checked with fps.mjs and the output
// runs at their own rate, never above. And it stays at native resolution, since
// downscaling throws away the mouth detail being judged.
//
//   node eval/_ab/fps.mjs eval/_ab/dry.webm   # >= 24fps, per source
//   node eval/_ab/build.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const FPS = 28; // just under the slowest source, never above
// Drive-relative: a drive letter's colon is an option separator to ffmpeg's
// filter parser and escaping it through two layers is not worth the fight.
const FONT = "/Windows/Fonts/arial.ttf";

const SEGMENTS = [
  ["dry", "1 of 3   DRY - what ships"],
  ["subtle", "2 of 3   8 percent room - 0.3dB from dry, i.e. inaudible"],
  ["room18", "3 of 3   18 percent room - audible, but reads as distant"],
];

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Size is read off the captures because the canvas is as big as the browser
// window was, so it changes between sessions -- and a gap clip built at the
// wrong size makes concat emit a file that players resize mid-playback.
const [W, H] = execFileSync("ffprobe", [
  "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height",
  "-of", "csv=p=0", join(HERE, `${SEGMENTS[0][0]}.webm`),
]).toString().trim().split(",").map(Number);
console.log(`sources are ${W}x${H}`);

for (const [name, label] of SEGMENTS) {
  const text = label.replace(/:/g, "\\:");
  ff([
    "-i", join(HERE, `${name}.webm`),
    "-vf", `scale=${W}:${H},fps=${FPS},drawtext=fontfile=${FONT}:text='${text}':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.65:boxborderw=16:x=32:y=32`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    join(HERE, `seg-${name}.mp4`),
  ]);
  console.log(`${name} -> seg-${name}.mp4`);
}

ff([
  "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${FPS}:d=0.6`,
  "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
  "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
  join(HERE, "gap.mp4"),
]);

const order = SEGMENTS.map(([n]) => `seg-${n}`).flatMap((s, i) => (i ? ["gap", s] : [s]));
const list = join(HERE, "list.txt");
writeFileSync(list, order.map((f) => `file '${join(HERE, f + ".mp4").replace(/\\/g, "/")}'`).join("\n"));
const out = join(HERE, "..", "voice-room-ab.mp4");
ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
unlinkSync(list);
console.log("wrote", out);
