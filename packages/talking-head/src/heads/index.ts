import type { HeadSettings } from "../avatar";
import { providers, type Provider } from "./catalog.ts";

export { providers };
export type { Provider };

export interface HeadInfo { ref: string; provider: string; label: string; license: string; browser: boolean }
export interface InstalledHead { ref: string; label: string; url: string; where: "browser" | "disk"; settings?: HeadSettings }

const ID = /^[a-z0-9-]+$/;
const CACHE = "talking-head-glb/heads";
// Cache Storage only takes http(s) keys; this origin is never fetched.
const cacheKey = (file: string) => `https://talking-head-glb.invalid/${file}`;
// One blob URL per cached file, so the GLB loader's URL-keyed cache parses each head once.
const blobUrls = new Map<string, string>();
export const refOf = (file: string) => file.replace(/^([a-z0-9-]+)\.([a-z0-9-]+)\.glb$/, "$1/$2");

/** Checks a `<provider>/<head>` ref against the catalog and returns what it names. */
export function parseRef(ref: string) {
  const parts = ref.split("/");
  const [providerId, id] = parts;
  const provider = parts.length === 2 && parts.every((part) => ID.test(part)) ? providers.find((p) => p.id === providerId) : undefined;
  const tested = !!provider && Object.hasOwn(provider.heads, id);
  if (!provider || !(tested || provider.catalog)) throw new Error(`"${ref}" is not a known head.`);
  return {
    provider,
    id,
    file: `${provider.id}.${id}.glb`,
    label: tested ? provider.heads[id] : id[0].toUpperCase() + id.slice(1).replace(/-/g, " "),
    url: "url" in provider.source ? provider.source.url.replaceAll("{id}", id) : undefined,
    settings: provider.settings && Object.hasOwn(provider.settings, id) ? provider.settings[id] : undefined,
  };
}

/** Adds a provider to the catalog, for heads this package does not ship. */
export function registerProvider(provider: Provider) {
  if (![provider.id, ...Object.keys(provider.heads)].every((id) => ID.test(id))) throw new Error(`Provider "${provider.id}" has an id outside ${ID}.`);
  if (providers.some((p) => p.id === provider.id)) throw new Error(`Provider "${provider.id}" is already registered.`);
  if (!("url" in provider.source)) throw new Error(`Provider "${provider.id}" needs a url source at runtime; add repo and build sources to src/heads/catalog.ts.`);
  providers.push(provider);
}

export const listHeads = (): HeadInfo[] =>
  providers.flatMap((p) => Object.entries(p.heads).map(([id, label]) => ({ ref: `${p.id}/${id}`, provider: p.name, label, license: p.license.name, browser: "url" in p.source })));

export const isGlb = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 4)) === "glTF";

/** Downloads a GLB over HTTPS and refuses anything that is not one. */
export async function fetchGlb(url: string, onProgress?: (fraction: number) => void) {
  if (!url.startsWith("https://")) throw new Error(`${url} is not an HTTPS URL.`);
  const response = await fetch(url);
  if (response.redirected && !response.url.startsWith("https://")) throw new Error(`${url} redirected to ${response.url}, which is not HTTPS.`);
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}.`);
  const total = Number(response.headers.get("content-length")) || 0;
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (const reader = response.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress?.(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  chunks.reduce((offset, chunk) => (bytes.set(chunk, offset), offset + chunk.length), 0);
  if (!isGlb(bytes)) throw new Error(`${url} is not a GLB file.`);
  return bytes;
}

/** Downloads a head into the browser's Cache Storage. */
export async function download(ref: string, { onProgress }: { onProgress?: (fraction: number) => void } = {}) {
  const { url, file } = parseRef(ref);
  if (!url) throw new Error(`${ref} is installed with the CLI: npx talking-head-glb heads add ${ref}`);
  const bytes = await fetchGlb(url, onProgress);
  await (await caches.open(CACHE)).put(cacheKey(file), new Response(bytes, { headers: { "content-type": "model/gltf-binary" } }));
}

/** Removes a head from the browser cache; disk heads are removed with the CLI. */
export async function remove(ref: string) {
  const { file } = parseRef(ref);
  await (await caches.open(CACHE)).delete(cacheKey(file));
  if (blobUrls.has(file)) URL.revokeObjectURL(blobUrls.get(file)!);
  blobUrls.delete(file);
}

function known(ref: string) {
  try {
    return parseRef(ref);
  } catch {
    return undefined;
  }
}

async function diskHeads(headsDir: string): Promise<InstalledHead[]> {
  try {
    const response = await fetch(`${headsDir}/heads.json`);
    // Dev servers answer a missing file with index.html.
    if (!response.ok || response.headers.get("content-type")?.includes("text/html")) return [];
    const entries: { ref: string; file: string }[] = await response.json();
    return entries.flatMap(({ ref, file }) => {
      const head = known(ref);
      return head && head.file === file ? [{ ref, label: head.label, url: `${headsDir}/${file}`, where: "disk" as const, settings: head.settings }] : [];
    });
  } catch {
    return [];
  }
}

async function browserHeads(): Promise<InstalledHead[]> {
  if (typeof caches === "undefined") return [];
  const keys = await (await caches.open(CACHE)).keys();
  return keys.flatMap((request) => {
    const ref = refOf(new URL(request.url).pathname.slice(1));
    const head = known(ref);
    return head?.url ? [{ ref, label: head.label, url: head.url, where: "browser" as const, settings: head.settings }] : [];
  });
}

/** Installed heads in catalog order: the heads folder's `heads.json` first, then the browser cache. */
export async function installed({ headsDir = "/heads" }: { headsDir?: string } = {}): Promise<InstalledHead[]> {
  const found = (await Promise.all([diskHeads(headsDir), browserHeads()])).flat();
  const heads = found.filter((head, i) => found.findIndex((other) => other.ref === head.ref) === i);
  const order = listHeads().map((head) => head.ref);
  const rank = (ref: string) => (order.indexOf(ref) + 1 || order.length + 1);
  return heads.sort((a, b) => rank(a.ref) - rank(b.ref));
}

/** A URL the loader can fetch for an installed ref: the heads folder first, then the browser cache. */
export async function loadHead(ref: string, headsDir = "/heads"): Promise<{ url: string; settings?: HeadSettings }> {
  const { file, settings } = parseRef(ref);
  const disk = (await diskHeads(headsDir)).find((head) => head.ref === ref);
  if (disk) return { url: disk.url, settings };
  if (!blobUrls.has(file)) {
    const cached = typeof caches === "undefined" ? undefined : await (await caches.open(CACHE)).match(cacheKey(file));
    if (!cached) throw new Error(`${ref} is not installed.`);
    blobUrls.set(file, URL.createObjectURL(await cached.blob()));
  }
  return { url: blobUrls.get(file)!, settings };
}
