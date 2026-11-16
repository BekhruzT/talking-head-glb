// Builds frontend/public/models/ict/ict-facekit.glb from USC ICT-FaceKit (MIT,
// https://github.com/ICT-VGL/ICT-FaceKit): the neutral head plus its 53 ARKit
// expressions as morph targets, flat-coloured since the free kit ships no textures.
//
//   node scripts/ict-facekit-to-glb.mjs [cacheDir]
//
// ponytail: downloads ~140MB of OBJs once into cacheDir (default: OS temp).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://raw.githubusercontent.com/ICT-VGL/ICT-FaceKit/master/FaceXModel";
const CACHE = process.argv[2] ?? join(tmpdir(), "ict-facekit");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../frontend/public/models/ict/ict-facekit.glb");

// Material groups -> primitive, colours in sRGB. M_Iris* is the whole eyeball,
// which the kit's textures paint; here it gets vertex colours instead. Skipped,
// since without textures they draw opaque over the eye: the sclera shell (its
// cornea is only clear by texture), the lacrimal, eye-blend and occlusion
// layers, and the lash cards.
const PARTS = [
  { name: "Skin", groups: ["M_Face", "M_BackHead"], color: [0.8, 0.6, 0.5], roughness: 0.6 },
  { name: "Mouth", groups: ["M_GumsTongue"], color: [0.6, 0.3, 0.3], roughness: 0.5 },
  { name: "Teeth", groups: ["M_Teeth"], color: [0.92, 0.9, 0.84], roughness: 0.35 },
  { name: "Eyes", groups: ["M_IrisLeft", "M_IrisRight"], color: [1, 1, 1], roughness: 0.15 },
];
// Eye colour by distance from the eye's forward axis, as a fraction of the ball's radius.
const EYE = [[0.16, [0.02, 0.02, 0.02]], [0.4, [0.3, 0.2, 0.12]], [0.46, [0.15, 0.1, 0.07]], [Infinity, [0.93, 0.91, 0.88]]];
const linear = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));

// ICT splits two ARKit shapes per side; ARKit has one of each.
const arkitName = (ict) => ({ browInnerUp_L: "browInnerUp", browInnerUp_R: "browInnerUp", cheekPuff_L: "cheekPuff", cheekPuff_R: "cheekPuff" })[ict]
  ?? ict.replace(/_L$/, "Left").replace(/_R$/, "Right");

async function fetchCached(file) {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    const res = await fetch(`${SOURCE}/${file}`);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
  }
  return readFile(path, "utf8");
}

function parseObj(text, withFaces) {
  const positions = [];
  const faces = {};
  let group;
  for (const line of text.split("\n")) {
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.trim().split(/\s+/);
      positions.push(+x, +y, +z);
    } else if (withFaces && line.startsWith("usemtl ")) {
      group = line.slice(7).trim();
      faces[group] ??= [];
    } else if (withFaces && line.startsWith("f ")) {
      const ids = line.trim().split(/\s+/).slice(1).map((token) => parseInt(token, 10) - 1);
      for (let i = 1; i + 1 < ids.length; i++) faces[group].push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return { positions: Float32Array.from(positions), faces };
}

// Area-weighted vertex normals over the given triangles.
function vertexNormals(positions, triangles) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t] * 3, triangles[t + 1] * 3, triangles[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { normals[i] += nx; normals[i + 1] += ny; normals[i + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;
  }
  return normals;
}

// --- glTF writer: one binary buffer, every view 4-byte aligned.
const chunks = [];
let byteLength = 0;
const bufferViews = [], accessors = [];
function view(typed) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
  chunks.push(bytes, Buffer.alloc(pad));
  byteLength += bytes.length + pad;
  return bufferViews.length - 1;
}
function vec3Bounds(values) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i++) { min[i % 3] = Math.min(min[i % 3], values[i]); max[i % 3] = Math.max(max[i % 3], values[i]); }
  return { min, max };
}
function vec3Accessor(values, bounds) {
  accessors.push({ bufferView: view(values), componentType: 5126, count: values.length / 3, type: "VEC3", ...(bounds ? vec3Bounds(values) : {}) });
  return accessors.length - 1;
}
// Morph deltas are mostly zero (an eye blink moves no mouth vertex), so store
// only the vertices that move. Sparse needs at least one entry.
function sparseDelta(delta, count, bounds, epsilon) {
  const moved = [];
  for (let v = 0; v < count; v++) {
    if (Math.abs(delta[v * 3]) + Math.abs(delta[v * 3 + 1]) + Math.abs(delta[v * 3 + 2]) > epsilon) moved.push(v);
  }
  if (!moved.length) moved.push(0);
  const values = new Float32Array(moved.length * 3);
  moved.forEach((v, i) => values.set(delta.subarray(v * 3, v * 3 + 3), i * 3));
  const extent = vec3Bounds(values);
  accessors.push({
    componentType: 5126, count, type: "VEC3",
    ...(bounds ? { min: extent.min.map((m) => Math.min(m, 0)), max: extent.max.map((m) => Math.max(m, 0)) } : {}),
    sparse: { count: moved.length, indices: { bufferView: view(Uint32Array.from(moved)), componentType: 5125 }, values: { bufferView: view(values) } },
  });
  return accessors.length - 1;
}

await mkdir(CACHE, { recursive: true });
const index = JSON.parse(await fetchCached("vertex_indices.json"));
const neutral = parseObj(await fetchCached("generic_neutral_mesh.obj"), true);
const vertexCount = neutral.positions.length / 3;
console.log(`neutral: ${vertexCount} vertices, groups ${Object.keys(neutral.faces).join(" ")}`);

const expressions = [];
for (let i = 0; i < index.expressions.length; i += 8) {
  const batch = index.expressions.slice(i, i + 8);
  const texts = await Promise.all(batch.map((name) => fetchCached(`${name}.obj`)));
  batch.forEach((name, j) => {
    const { positions } = parseObj(texts[j], false);
    if (positions.length !== neutral.positions.length) throw new Error(`${name}: ${positions.length / 3} vertices, expected ${vertexCount}`);
    expressions.push({ name, positions });
  });
  console.log(`expressions: ${expressions.length}/${index.expressions.length}`);
}

// ICT is in centimetres; the app's camera expects metres.
const SCALE = 0.01;
const allTriangles = PARTS.flatMap((part) => part.groups.flatMap((g) => neutral.faces[g] ?? []));
const neutralNormals = vertexNormals(neutral.positions, allTriangles);

// Merge split shapes by summing their deltas, keeping ARKit order of first appearance.
const targets = new Map();
for (const { name, positions } of expressions) {
  const delta = Float32Array.from(positions, (p, i) => (p - neutral.positions[i]) * SCALE);
  const normalDelta = vertexNormals(positions, allTriangles).map((n, i) => n - neutralNormals[i]);
  const merged = targets.get(arkitName(name));
  if (merged) {
    merged.delta.forEach((_, i) => { merged.delta[i] += delta[i]; });
    // Normals do not sum; the larger change per vertex is a fair approximation.
    merged.normalDelta.forEach((n, i) => { if (Math.abs(normalDelta[i]) > Math.abs(n)) merged.normalDelta[i] = normalDelta[i]; });
  } else targets.set(arkitName(name), { delta, normalDelta });
}

const scaled = neutral.positions.map((p) => p * SCALE);
const { min, max } = vec3Bounds(scaled);
console.log(`bounds (m): min ${min.map((v) => v.toFixed(3))} max ${max.map((v) => v.toFixed(3))}`);
// Pivot the neck turn roughly where a skull sits on the spine: centred, a third
// of the way up the mesh, towards the back of the head.
const pivot = [0, min[1] + (max[1] - min[1]) * 0.35, min[2] + (max[2] - min[2]) * 0.35];

const colors = new Float32Array(scaled.length);
for (const side of ["Left", "Right"]) {
  const ball = [...new Set(neutral.faces[`M_Iris${side}`])];
  const axis = (a) => ball.map((v) => scaled[v * 3 + a]);
  const center = [0, 1, 2].map((a) => (Math.min(...axis(a)) + Math.max(...axis(a))) / 2);
  const radius = (Math.max(...axis(2)) - Math.min(...axis(2))) / 2;
  ball.forEach((v) => {
    const off = Math.hypot(scaled[v * 3] - center[0], scaled[v * 3 + 1] - center[1]) / radius;
    const front = scaled[v * 3 + 2] > center[2];
    colors.set(linear(EYE.find(([edge]) => front && off < edge)?.[1] ?? EYE[EYE.length - 1][1]), v * 3);
  });
}

const materials = PARTS.map(({ name, color, roughness }) => ({ name, pbrMetallicRoughness: { baseColorFactor: [...linear(color), 1], metallicFactor: 0, roughnessFactor: roughness } }));
const primitives = PARTS.map((part, material) => {
  const triangles = part.groups.flatMap((g) => neutral.faces[g] ?? []);
  const used = [...new Set(triangles)].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));
  const pick = (source) => {
    const out = new Float32Array(used.length * 3);
    used.forEach((v, i) => out.set(source.subarray(v * 3, v * 3 + 3), i * 3));
    return out;
  };
  const indices = used.length < 65536 ? Uint16Array.from(triangles, (v) => remap.get(v)) : Uint32Array.from(triangles, (v) => remap.get(v));
  accessors.push({ bufferView: view(indices), componentType: indices instanceof Uint16Array ? 5123 : 5125, count: indices.length, type: "SCALAR" });
  const indexAccessor = accessors.length - 1;
  return {
    attributes: {
      POSITION: vec3Accessor(pick(scaled), true),
      NORMAL: vec3Accessor(pick(neutralNormals), false),
      ...(part.name === "Eyes" ? { COLOR_0: vec3Accessor(pick(colors), false) } : {}),
    },
    indices: indexAccessor,
    material,
    // 10 micrometres and ~0.1 degree of normal: anything less never shows on screen.
    targets: [...targets.values()].map(({ delta, normalDelta }) => ({
      POSITION: sparseDelta(pick(delta), used.length, true, 1e-5),
      NORMAL: sparseDelta(pick(normalDelta), used.length, false, 2e-3),
    })),
  };
});

const gltf = {
  asset: { version: "2.0", generator: "talking-head-glb scripts/ict-facekit-to-glb.mjs", copyright: "ICT-FaceKit, USC Institute for Creative Technologies, MIT" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  // "Head" is a plain node, not a bone: the app turns it for neck movement.
  nodes: [
    { name: "ICTFaceKit", children: [1] },
    { name: "Head", translation: pivot, children: [2] },
    { name: "Face", mesh: 0, translation: pivot.map((v) => -v) },
  ],
  meshes: [{ name: "Face", primitives, weights: [...targets.keys()].map(() => 0), extras: { targetNames: [...targets.keys()] } }],
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

const json = Buffer.from(JSON.stringify(gltf));
const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binChunk = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const chunkHeader = (length, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(length, 0); b.writeUInt32LE(type, 4); return b; };
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]));
console.log(`wrote ${OUT}: ${(header.readUInt32LE(8) / 1e6).toFixed(1)} MB, ${targets.size} morph targets, ${PARTS.length} parts`);
