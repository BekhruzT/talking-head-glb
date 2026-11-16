import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(root, "frontend", "public", "models");
const ID = /^[a-z0-9-]+$/;

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command, args, cwd, failure) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(failure);
}

const readFamily = (models, family) => readFile(join(models, family, "family.json"), "utf8").then(JSON.parse).catch((error) => {
  if (error.code === "ENOENT") return {};
  throw new Error(`${join(models, family, "family.json")}: ${error.message}`);
});

const folders = async (models) => (await readdir(models, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

/** One `[family]` or `[family=<id>,...]` per configured family; a family that lists no labels needs ids. */
const usage = (families) => `Usage: npm run setup:model -- ${Object.entries(families).map(([name, family]) => family.labels ? `[${name}]` : `[${name}=<id>[,<id>...]]`).join(" ")}`;

/** Turns command-line words into [family, id] installs, refusing anything not configured. */
export function parseArgs(args, families) {
  return args.flatMap((arg) => {
    const [name, list, extra] = arg.split("=");
    const family = Object.hasOwn(families, name) ? families[name] : undefined;
    const ids = list === undefined ? Object.keys(family?.labels ?? {}) : list.split(",");
    // A family with labels ships fixed files, so only its labelled ids exist.
    const known = (id) => ID.test(id) && (!family.labels || Object.hasOwn(family.labels, id));
    if (!family?.source || extra !== undefined || !ids.length || !ids.every(known)) throw new Error(`Invalid argument "${arg}".\n${usage(families)}`);
    return ids.map((id) => [name, id]);
  });
}

/** Writes models/heads.json listing every installed GLB, Ava's family first. */
export async function buildManifest(models) {
  const heads = [];
  for (const family of (await folders(models)).sort((a, b) => (b === "ava") - (a === "ava") || a.localeCompare(b))) {
    const { labels = {} } = await readFamily(models, family);
    for (const file of (await readdir(join(models, family))).filter((name) => name.endsWith(".glb")).sort()) {
      const id = file.slice(0, -4);
      heads.push({ id, family, label: labels[id] ?? id[0].toUpperCase() + id.slice(1).replace(/-/g, " "), path: `/models/${family}/${file}` });
    }
  }
  await writeFile(join(models, "heads.json"), `${JSON.stringify(heads, null, 2)}\n`);
  return heads;
}

async function installFromRepo(destination, label, { repo, sha256: expected }) {
  try {
    if (await sha256(destination) === expected) return console.log(`${label} model is already installed and verified.`);
    throw new Error(`A different file is already at ${destination}. Move it aside before setup.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "talking-head-glb-"));
  const cloneDir = join(tempRoot, "model");
  const staged = join(dirname(destination), `.${basename(destination)}-${process.pid}.tmp`);
  try {
    run("gh", ["repo", "clone", repo, cloneDir, "--", "--depth", "1"], root,
      `Could not clone ${repo}. Sign in with an approved account (owner: gh auth switch --user BekhruzT) and retry.`);
    run("git", ["-C", cloneDir, "lfs", "pull"], root, `Git LFS is required to download the ${label} model.`);

    const source = join(cloneDir, relative(root, destination));
    if (await sha256(source) !== expected) throw new Error(`The downloaded ${label} model failed SHA-256 verification.`);

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, staged);
    await rename(staged, destination);
    console.log(`${label} model installed and verified at ${destination}`);
  } finally {
    await rm(staged, { force: true });
    const resolvedTemp = await realpath(tempRoot);
    if (dirname(resolvedTemp) !== await realpath(tmpdir()) || !basename(resolvedTemp).startsWith("talking-head-glb-")) {
      throw new Error("Refusing to remove a temporary directory outside the expected location.");
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function install(name, id, { source, labels = {}, catalog }) {
  const destination = join(MODELS, name, `${id}.glb`);
  const label = labels[id] ?? id;
  if (source.repo) return installFromRepo(destination, label, source);
  if (existsSync(destination)) return console.log(`${label} is already installed at ${destination}`);
  if (source.build) {
    run("node", [join(root, source.build)], root, `${source.build} failed to build ${label}.`);
    return console.log(`${label} built at ${destination}`);
  }

  const url = source.url.replaceAll("{id}", id);
  if (!url.startsWith("https://")) throw new Error(`Refusing to download ${label} over a non-HTTPS URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download of ${label} failed with HTTP ${response.status} from ${url}${catalog ? `. Available ids: ${catalog}` : ""}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 4).toString() !== "glTF") throw new Error(`${url} is not a GLB file.`);

  const staged = `${destination}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(staged, bytes);
    await rename(staged, destination);
    console.log(`${label} installed at ${destination}`);
  } finally {
    await rm(staged, { force: true });
  }
}

async function main() {
  const families = Object.fromEntries((await Promise.all((await folders(MODELS)).map(async (name) => [name, await readFamily(MODELS, name)]))).filter(([, family]) => family.source));
  const requests = parseArgs(process.argv.slice(2), families);
  if (!requests.length) {
    console.log(usage(families));
    Object.entries(families).forEach(([name, { catalog }]) => catalog && console.log(`Find ${name} ids at ${catalog}`));
  }

  let failed = false;
  for (const [name, id] of requests) {
    await install(name, id, families[name]).catch((error) => {
      console.error(`${name}/${id}: ${error.message}`);
      failed = true;
    });
  }
  const heads = await buildManifest(MODELS);
  console.log(`${heads.length} heads listed in ${join(MODELS, "heads.json")}`);
  if (failed) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
