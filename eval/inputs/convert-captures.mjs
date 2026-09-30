// Converts captured case*.webm files to reviewable MP4s, trimmed to speech
// onset and padded to even dimensions for H.264. Trimming on the audio rather
// than the first non-black frame is what makes the two columns comparable: the
// dead head is however long the pipeline took to answer (~2s for a fixture, ~6s
// for live Azure TTS), and compare.html's DTW tolerates only a second or two.
// Only webm is consumed, so re-running is safe -- trimming itself is not
// idempotent, since the video track outruns the audio and a second pass over an
// already-trimmed MP4 nibbles the tail.
//
// Usage: node eval/inputs/convert-captures.mjs [dir]   (dir defaults to "reference")
import { readdirSync, renameSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", process.argv[2] ?? "reference");
const LEAD = 0.3; // mouth visibly at rest before the first word
const TAIL = 0.4;
// captureStream is asked for 30 and a healthy capture lands at 14-30. The
// failure this catches sits at ~1, so the bar is low enough not to trip on
// ordinary jitter.
const MIN_FPS = 10;

/** [start, end] of speech, from ffmpeg's silencedetect, widened by LEAD/TAIL. */
function speechSpan(file) {
  const log = execSync(`ffmpeg -v info -i "${file}" -af "silencedetect=noise=-40dB:d=0.2" -f null NUL 2>&1`, {
    encoding: "utf8",
    shell: "cmd.exe",
    maxBuffer: 1 << 26,
  });
  // Duration comes from this pass's own progress output, because MediaRecorder
  // webm is written live with no duration in the header and ffprobe reports N/A.
  const times = [...log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times.at(-1);
  if (!last) throw new Error(`no duration for ${file}`);
  const dur = +last[1] * 3600 + +last[2] * 60 + +last[3];

  // A silent capture converts fine and thumbnails fine, but every audio-derived
  // score reads garbage. MediaRecorder produces exactly this when handed a
  // stream whose audio track had not appeared yet, so check rather than assume.
  if (!/Stream #\d+:\d+.*: Audio:/.test(log)) {
    throw new Error(`${file}: no audio stream -- the capture recorded video only, re-record it`);
  }

  // Chrome throttles rAF in a backgrounded window and the canvas renders on
  // rAF, so a capture taken while not frontmost is a ~1fps slideshow that still
  // thumbnails plausibly. Refuse it rather than let it become a reference.
  const frames = +[...log.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
  const fps = frames / dur;
  if (!(fps >= MIN_FPS)) {
    throw new Error(
      `${file}: captured at ${fps.toFixed(1)}fps (${frames} frames / ${dur.toFixed(1)}s), need >=${MIN_FPS}. ` +
        `Bring the browser window to the front (page.bringToFront()) and re-record.`
    );
  }

  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);

  // A leading run of silence starts at ~0; where it ends is the first word.
  const start = starts.length && starts[0] < 0.5 ? ends[0] ?? dur : 0;
  // The last run is the trailing one only if it reaches the end of the file --
  // otherwise it is a pause mid-sentence and cutting there would lose speech.
  const i = starts.length - 1;
  const trailing = i >= 0 && starts[i] > start && (ends[i] === undefined || dur - ends[i] < 0.15);
  const end = trailing ? starts[i] : dur;

  return [Math.max(0, start - LEAD), Math.min(dur, end + TAIL), fps];
}

// case## is the BEAT corpus, etf## the 3D-ETF one (eval/inputs2).
for (const f of readdirSync(dir).filter((f) => /^(case|etf)\d+\.webm$/.test(f))) {
  const src = join(dir, f);
  const out = join(dir, f.replace(/\.webm$/, ".mp4"));
  const tmp = `${out}.tmp.mp4`;
  const [a, b, fps] = speechSpan(src);
  execSync(
    `ffmpeg -y -v error -ss ${a.toFixed(2)} -t ${(b - a).toFixed(2)} -i "${src}" ` +
      `-vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" -c:v libx264 -crf 20 -c:a aac "${tmp}"`,
    { shell: "cmd.exe" }
  );
  unlinkSync(src);
  renameSync(tmp, out);
  console.log(`${f} -> mp4  speech ${a.toFixed(2)}-${b.toFixed(2)}s (${(b - a).toFixed(2)}s)  ${fps.toFixed(0)}fps`);
}
console.log("done");
