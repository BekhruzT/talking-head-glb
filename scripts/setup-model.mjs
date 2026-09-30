import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const relativeModelPath = join("frontend", "public", "models", "ava", "ava.glb");
const destination = join(root, relativeModelPath);
const modelRepository = "BekhruzT/talking-head-glb-model";
const expectedSha256 = "1821dabc3e0ab62359b7b07d9504970391398375421175cba0b6e5c0a9d45792";

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command, args, cwd, failure) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(failure);
}

async function main() {
  try {
    if (await sha256(destination) === expectedSha256) {
      console.log("Ava model is already installed and verified.");
      return;
    }
    throw new Error(`A different file is already at ${destination}. Move it aside before setup.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "talking-head-glb-"));
  const cloneDir = join(tempRoot, "model");
  const staged = join(dirname(destination), `.ava.glb-${process.pid}.tmp`);
  try {
    run("gh", ["repo", "clone", modelRepository, cloneDir, "--", "--depth", "1"], root,
      `Could not clone ${modelRepository}. Sign in to GitHub CLI with an approved account and retry.`);
    run("git", ["-C", cloneDir, "lfs", "pull"], root, "Git LFS is required to download the Ava model.");

    const source = join(cloneDir, relativeModelPath);
    if (await sha256(source) !== expectedSha256) throw new Error("The downloaded Ava model failed SHA-256 verification.");

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, staged);
    await rename(staged, destination);
    console.log(`Ava model installed and verified at ${destination}`);
  } finally {
    await rm(staged, { force: true });
    const resolvedTemp = await realpath(tempRoot);
    if (dirname(resolvedTemp) !== await realpath(tmpdir()) || !basename(resolvedTemp).startsWith("talking-head-glb-")) {
      throw new Error("Refusing to remove a temporary directory outside the expected location.");
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
