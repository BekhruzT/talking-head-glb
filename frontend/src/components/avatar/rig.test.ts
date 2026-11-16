import { blendShapeIndices } from "./animations";
import { AZURE_BLENDSHAPE_NAMES } from "./blendshape-stream";
import { canonicalName, resolveRig } from "./rig";

const ARKIT = AZURE_BLENDSHAPE_NAMES.slice(0, 52);
const pascal = (name: string) => name[0].toUpperCase() + name.slice(1);
const OCULUS = ["Sil", "PP", "FF", "TH", "DD", "KK", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];

// Rocketbox order: 15 Oculus visemes, then AK_01..AK_52 in Apple's documented order.
const rocketbox: { [name: string]: number } = {};
OCULUS.forEach((v, i) => (rocketbox[`AA_VI_${String(i).padStart(2, "0")}_${v}`] = i));
[...ARKIT].sort().forEach((name, i) => (rocketbox[`AK_${String(i + 1).padStart(2, "0")}_${pascal(name)}`] = 15 + i));

test("Rocketbox AK_ names land every ARKit channel on its own morph target", () => {
  expect(canonicalName("AK_18_JawOpen")).toBe("jawOpen");
  const rig = resolveRig([rocketbox], blendShapeIndices, true);
  ARKIT.forEach((name) => {
    const slot = rig.indices[name];
    expect(slot).toBeDefined();
    expect(Object.keys(rocketbox)[rig.slots[0][slot]]).toBe(`AK_${String([...ARKIT].sort().indexOf(name) + 1).padStart(2, "0")}_${pascal(name)}`);
  });
  // Channels from the default table keep their slot; new ones go after it.
  expect(rig.indices.jawOpen).toBe(blendShapeIndices.jawOpen);
  expect(rig.indices.tongueOut).toBeGreaterThan(Math.max(...Object.values(blendShapeIndices)));
});

test("Microsoft viseme channels fall back to the rig's Oculus visemes", () => {
  const rig = resolveRig([rocketbox], blendShapeIndices, true);
  expect(rig.slots[0][rig.indices.p_b_m_21]).toBe(rocketbox.AA_VI_01_PP);
  expect(rig.slots[0][rig.indices.k_g_ng_20]).toBe(rocketbox.AA_VI_05_KK);
  expect(rig.slots[0][rig.indices.aa_02]).toBe(rocketbox.AA_VI_10_aa);
  expect(rig.slots[0][rig.indices.ae_ax_ah_01]).toBe(rocketbox.AA_VI_10_aa);
});

test("channels folded onto one morph target know each other, so a crossfade between them can combine", () => {
  const rig = resolveRig([rocketbox], blendShapeIndices, true);
  const slot = (name: string) => rig.indices[name];
  expect(rig.shared.get(slot("h_12"))).toEqual([slot("ey_eh_uh_04")]);
  expect([...rig.shared.get(slot("aa_02"))!].sort()).toEqual([slot("ae_ax_ah_01"), slot("aw_09"), slot("ay_11")].sort());
  expect(rig.shared.has(slot("p_b_m_21"))).toBe(false);
  expect(rig.shared.has(slot("jawOpen"))).toBe(false);
  expect(resolveRig([blendShapeIndices], blendShapeIndices, false).shared.size).toBe(0);
});

test("neck channels become bone-driven only when the rig has a head bone", () => {
  const withBone = resolveRig([rocketbox], blendShapeIndices, true);
  ["HeadUp", "HeadDown", "TrunLeft", "TrunRight"].forEach((name) => {
    expect(withBone.virtual.has(withBone.indices[name])).toBe(true);
  });
  const without = resolveRig([rocketbox], blendShapeIndices, false);
  expect(without.indices.HeadUp).toBeUndefined();
  expect(without.virtual.size).toBe(0);
  // Shapes nobody ships stay unaddressable rather than writing to a wrong slot.
  expect(withBone.indices.HeadForward).toBeUndefined();
});

test("Ava's own names and an unnamed GLB both resolve to the default table", () => {
  const ava = Object.fromEntries(Object.entries(blendShapeIndices));
  const named = resolveRig([ava, ava], blendShapeIndices, false);
  expect(named.indices).toEqual(blendShapeIndices);
  expect(named.slots[1][blendShapeIndices.HeadUp]).toBe(blendShapeIndices.HeadUp);

  const unnamed = Object.fromEntries(Object.values(blendShapeIndices).map((i) => [String(i), i]));
  expect(resolveRig([unnamed], blendShapeIndices, false).indices).toEqual(blendShapeIndices);
});

test("each mesh is addressed by its own morph index", () => {
  const teeth = { AK_01_JawOpen: 0 };
  const rig = resolveRig([rocketbox, teeth], blendShapeIndices, false);
  expect(rig.slots[1][rig.indices.jawOpen]).toBe(0);
  expect(rig.slots[1][rig.indices.mouthSmileLeft]).toBe(-1);
});
