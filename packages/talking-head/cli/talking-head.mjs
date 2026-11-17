#!/usr/bin/env node
// Installs heads into one flat folder: <provider>.<head>.glb files plus heads.json.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGlb, isGlb, listHeads, parseRef, providers, refOf } from "talking-head-glb/heads";

const USAGE = `Usage: talking-head-glb heads <list | add <ref...> | remove <ref...>> [--dir public/heads]
A ref is <provider>/<head>, for example rocketbox/medical-female-01.`;

const args = process.argv.slice(2);
const dirAt = args.indexOf("--dir");
if (dirAt >= 0 && !args[dirAt + 1]) usage(1);
const dir = resolve(dirAt >= 0 ? args.splice(dirAt, 2)[1] : "public/heads");
const [scope, command, ...refs] = args;
if (!command) usage(0);
if (scope !== "heads" || !["list", "add", "remove"].includes(command) || (command !== "list" && !refs.length)) usage(1);

function usage(code) {
  console.log(USAGE);
  process.exit(code);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const onDisk = (dir) => readdir(dir).catch(() => []);

function run(command, args, failure) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(failure);
}

async function inTemp(work) {
  const temp = await mkdtemp(join(tmpdir(), "talking-head-glb-"));
  try {
    return await work(temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const obtain = ({ provider: { source }, url }, ref) =>
  url ? fetchGlb(url)
  : "repo" in source ? inTemp(async (temp) => {
    run("gh", ["repo", "clone", source.repo, join(temp, "repo"), "--", "--depth", "1"], `could not clone ${source.repo}; sign in to gh with an account that has access.`);
    run("git", ["-C", join(temp, "repo"), "lfs", "pull"], "Git LFS is required for this head.");
    return readFile(join(temp, "repo", source.path));
  })
  : inTemp(async (temp) => {
    run(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), `${source.build}-to-glb.mjs`), join(temp, "head.glb")], `building ${ref} failed.`);
    return readFile(join(temp, "head.glb"));
  });

const verified = (head, bytes) => isGlb(bytes) && (!("sha256" in head.provider.source) || sha256(bytes) === head.provider.source.sha256);

async function add(ref) {
  const head = parseRef(ref);
  const target = join(dir, head.file);
  if (verified(head, await readFile(target).catch(() => Buffer.alloc(0)))) return console.log(`${ref}: already installed`);
  const bytes = await obtain(head, ref);
  if (!verified(head, bytes)) throw new Error("the download is not the expected GLB.");
  const staged = join(dir, `.${head.file}.${process.pid}.tmp`);
  await writeFile(staged, bytes);
  await rename(staged, target);
  console.log(`${ref}: installed at ${target}`);
}

async function remove(ref) {
  await rm(join(dir, parseRef(ref).file), { force: true });
  console.log(`${ref}: removed`);
}

async function writeIndex() {
  const entries = (await onDisk(dir)).flatMap((file) => {
    const ref = refOf(file);
    try {
      return parseRef(ref).file === file ? [{ ref, file }] : [];
    } catch {
      return [];
    }
  });
  await writeFile(join(dir, "heads.json"), `${JSON.stringify(entries, null, 2)}\n`);
}

if (command === "list") {
  const files = new Set(await onDisk(dir));
  console.log(`* installed in ${dir}`);
  for (const { ref, label, browser, license } of listHeads()) {
    console.log(`${files.has(parseRef(ref).file) ? "*" : " "} ${ref.padEnd(30)} ${label.padEnd(20)} ${(browser ? "browser" : "CLI only").padEnd(9)} ${license}`);
  }
  for (const { name, catalog } of providers) if (catalog) console.log(`Find more ${name} ids at ${catalog}`);
} else {
  if (command === "add") await mkdir(dir, { recursive: true });
  let failed = false;
  for (const ref of refs) {
    try {
      await (command === "add" ? add(ref) : remove(ref));
    } catch (error) {
      console.error(`${ref}: ${error.message}`);
      failed = true;
    }
  }
  if ((await onDisk(dir)).length || command === "add") await writeIndex();
  process.exitCode = failed ? 1 : 0;
}
