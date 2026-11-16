import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildManifest, parseArgs } from "./setup-model.mjs";

const FAMILIES = {
  ava: { labels: { ava: "Ava" }, source: { repo: "owner/repo", sha256: "0" } },
  rocketbox: { source: { url: "https://example.com/{id}.glb" } },
};

test("the manifest lists every GLB on disk, Ava's family first, with labels from family.json or the id", async () => {
  const models = await mkdtemp(join(tmpdir(), "setup-model-test-"));
  try {
    const files = ["rocketbox/medical-male-01.glb", "rocketbox/business-female-02.glb", "ava/ava.glb", "ava/notes.txt", "mpfb/mpfb.glb", "mpfb/mpfb.glb.123.tmp"];
    for (const file of files) {
      await mkdir(join(models, file, ".."), { recursive: true });
      await writeFile(join(models, file), "glTF");
    }
    await writeFile(join(models, "ava", "family.json"), JSON.stringify(FAMILIES.ava));

    await buildManifest(models);

    assert.deepEqual(JSON.parse(await readFile(join(models, "heads.json"), "utf8")), [
      { id: "ava", family: "ava", label: "Ava", path: "/models/ava/ava.glb" },
      { id: "mpfb", family: "mpfb", label: "Mpfb", path: "/models/mpfb/mpfb.glb" },
      { id: "business-female-02", family: "rocketbox", label: "Business female 02", path: "/models/rocketbox/business-female-02.glb" },
      { id: "medical-male-01", family: "rocketbox", label: "Medical male 01", path: "/models/rocketbox/medical-male-01.glb" },
    ]);
  } finally {
    await rm(models, { recursive: true, force: true });
  }
});

test("arguments become installs, and nothing is installed without arguments", () => {
  assert.deepEqual(parseArgs([], FAMILIES), []);
  assert.deepEqual(parseArgs(["ava", "rocketbox=medical-female-01,police-female-01"], FAMILIES), [
    ["ava", "ava"], ["rocketbox", "medical-female-01"], ["rocketbox", "police-female-01"],
  ]);
});

test("an id that could leave the models folder, a family without ids, an id a fixed-file family lacks, or an unknown family is refused", () => {
  for (const args of [["rocketbox=../x"], ["rocketbox"], ["rocketbox="], ["rocketbox=a=b"], ["ava=foo"], ["unknown"], ["__proto__"]]) {
    assert.throws(() => parseArgs(args, FAMILIES), /Usage: npm run setup:model/, args.join(" "));
  }
});
