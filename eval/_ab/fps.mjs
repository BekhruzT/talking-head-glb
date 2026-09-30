// Frame count of a capture, so an A/B is not judged on a throttled recording.
// Canvas captures are variable-rate and swing from 7 to 29 fps depending on
// whether the window really had focus, which looks exactly like bad lip-sync.
import { execFileSync } from "node:child_process";

const file = process.argv[2];
const frames = +execFileSync("ffprobe", [
  "-v", "error", "-select_streams", "v", "-count_frames",
  "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file,
]).toString().trim();
const seconds = +execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
]).toString().trim();
console.log(`${file}  frames=${frames}  ${(frames / seconds).toFixed(1)}fps`);
process.exit(frames / seconds >= 24 ? 0 : 1);
