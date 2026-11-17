import { download, installed, listHeads, parseRef, registerProvider } from "./index.ts";

const GLB = new TextEncoder().encode("glTF\u0002\u0000\u0000\u0000");
const HF = "https://huggingface.co/datasets/codepawl/rocketbox-avatars-glb/resolve/main/objects";

function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    put: async (key: string, response: Response) => void store.set(key, response),
    match: async (key: string) => store.get(key)?.clone(),
    delete: async (key: string) => store.delete(key),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
  vi.stubGlobal("caches", { open: async () => cache });
  return store;
}

const serve = (routes: Record<string, () => Response>) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => routes[url]?.() ?? new Response("missing", { status: 404 })));

afterEach(() => vi.unstubAllGlobals());

test("listHeads lists the 7 tested heads and which ones the browser can download", () => {
  expect(listHeads().map(({ ref, browser }) => [ref, browser])).toEqual([
    ["ava/ava", false],
    ["ict/ict-facekit", false],
    ["mpfb/mpfb", true],
    ["rocketbox/medical-female-01", true],
    ["rocketbox/medical-male-01", true],
    ["rocketbox/business-female-02", true],
    ["rocketbox/business-male-03", true],
  ]);
});

test.each(["rocketbox/../x", "nope/x", "__proto__/x", "mpfb/other", "rocketbox/", "rocketbox/a/b"])("refuses the ref %s", (ref) => {
  expect(() => parseRef(ref)).toThrow(/not a known head/);
});

test("accepts any id on a provider with a catalog", () => {
  expect(parseRef("rocketbox/police-female-01")).toMatchObject({
    file: "rocketbox.police-female-01.glb",
    label: "Police female 01",
    url: `${HF}/police-female-01/police-female-01.glb`,
  });
});

test("download caches a GLB, and installed then lists it from the browser", async () => {
  const store = fakeCaches();
  serve({ [`${HF}/medical-male-01/medical-male-01.glb`]: () => new Response(GLB) });

  await download("rocketbox/medical-male-01");

  expect(store.size).toBe(1);
  expect(await installed()).toEqual([
    { ref: "rocketbox/medical-male-01", label: "Medical male 01", url: `${HF}/medical-male-01/medical-male-01.glb`, where: "browser", settings: undefined },
  ]);
});

test("a head both on disk and in the browser cache is listed once, from disk", async () => {
  const store = fakeCaches();
  store.set("https://talking-head-glb.invalid/rocketbox.medical-male-01.glb", new Response(GLB));
  serve({ "/heads/heads.json": () => Response.json([{ ref: "rocketbox/medical-male-01", file: "rocketbox.medical-male-01.glb" }]) });

  expect((await installed()).map(({ ref, where }) => [ref, where])).toEqual([["rocketbox/medical-male-01", "disk"]]);
});

test("download refuses a body that is not a GLB and a CLI-only head", async () => {
  const store = fakeCaches();
  serve({ "https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/mpfb.glb": () => new Response("version https://git-lfs.github.com/spec/v1") });

  await expect(download("mpfb/mpfb")).rejects.toThrow(/not a GLB/);
  await expect(download("ava/ava")).rejects.toThrow("ava/ava is installed with the CLI: npx talking-head-glb heads add ava/ava");
  expect(store.size).toBe(0);
});

test("installed reads heads.json in catalog order and skips entries that do not match their ref", async () => {
  serve({
    "/heads/heads.json": () => Response.json([
      { ref: "rocketbox/medical-female-01", file: "rocketbox.medical-female-01.glb" },
      { ref: "ava/ava", file: "ava.ava.glb" },
      { ref: "mpfb/mpfb", file: "../mpfb.glb" },
      { ref: "nope/x", file: "nope.x.glb" },
    ]),
  });

  expect(await installed()).toEqual([
    { ref: "ava/ava", label: "Ava", url: "/heads/ava.ava.glb", where: "disk", settings: { position: [0, -1.72, 0] } },
    { ref: "rocketbox/medical-female-01", label: "Medical female 01", url: "/heads/rocketbox.medical-female-01.glb", where: "disk", settings: undefined },
  ]);
});

test.each([
  ["missing", () => new Response("missing", { status: 404 })],
  ["answered with the dev server's index.html", () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })],
])("installed is empty when heads.json is %s", async (_, response) => {
  serve({ "/heads/heads.json": response });
  expect(await installed()).toEqual([]);
});

test("registerProvider adds a provider's heads and refuses a duplicate or a bad id", () => {
  const provider = { id: "acme", name: "Acme", license: { name: "MIT", url: "https://example.com" }, heads: { robot: "Robot" }, source: { url: "https://example.com/{id}.glb" } };

  registerProvider(provider);

  expect(listHeads().at(-1)).toEqual({ ref: "acme/robot", provider: "Acme", label: "Robot", license: "MIT", browser: true });
  expect(() => registerProvider(provider)).toThrow(/already registered/);
  expect(() => registerProvider({ ...provider, id: "Bad_Id" })).toThrow(/outside/);
  expect(() => registerProvider({ ...provider, id: "lfs", source: { repo: "acme/heads", path: "robot.glb", sha256: "" } })).toThrow(/needs a url source/);
});
