// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../cli/talking-head.mjs", import.meta.url));
const run = (args: string[], cwd?: string) => spawnSync(process.execPath, ["--conditions=source", CLI, ...args], { cwd, encoding: "utf8" });
const tempDir = () => mkdtempSync(join(tmpdir(), "talking-head-cli-"));

test("add rebuilds heads.json from the GLBs in the folder", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "mpfb.mpfb.glb"), "glTF head");
  writeFileSync(join(dir, "notes.glb"), "glTF stray");

  const result = run(["heads", "add", "mpfb/mpfb", "--dir", dir]);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("mpfb/mpfb: already installed");
  expect(JSON.parse(readFileSync(join(dir, "heads.json"), "utf8"))).toEqual([{ ref: "mpfb/mpfb", file: "mpfb.mpfb.glb" }]);
});

test("no arguments prints usage, downloads nothing and exits 0", () => {
  const cwd = tempDir();

  const result = run([], cwd);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Usage: talking-head-glb heads");
  expect(readdirSync(cwd)).toEqual([]);
});

test("a bad ref is reported with its ref and exits 1", () => {
  const dir = tempDir();

  const result = run(["heads", "add", "rocketbox/../x", "--dir", dir]);

  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^rocketbox\/\.\.\/x: /);
  expect(readdirSync(dir)).toEqual(["heads.json"]);
});
