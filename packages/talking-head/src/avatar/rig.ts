/**
 * Maps the animation channels the avatar code speaks in (ARKit names, the
 * Microsoft viseme names, and Ava's HeadUp/TrunLeft neck shapes) onto whatever
 * morph targets a GLB actually ships, so any ARKit-rigged head drops in.
 *
 * A channel keeps the slot number it has in the default index table, so code
 * that reasons about slot ranges keeps meaning the same channels on every rig.
 */
export const HEAD_CHANNELS = ["HeadUp", "HeadDown", "TrunLeft", "TrunRight"];

// Microsoft viseme channel -> Oculus viseme suffix, for rigs that ship the
// 15 Oculus visemes (Rocketbox `AA_VI_10_aa`, Ready Player Me `viseme_aa`).
const OCULUS_VISEMES: { [channel: string]: string } = {
  ae_ax_ah_01: "aa", aa_02: "aa", ao_03: "O", ey_eh_uh_04: "E", er_05: "RR",
  y_iy_ih_ix_06: "I", w_uw_07: "U", ow_08: "O", aw_09: "aa", oy_10: "O",
  ay_11: "aa", h_12: "E", r_13: "RR", l_14: "nn", s_z_15: "SS",
  sh_ch_jh_zh_16: "CH", th_dh_17: "TH", f_v_18: "FF", d_t_n_19: "DD",
  k_g_ng_20: "kk", p_b_m_21: "PP",
};

export interface Rig {
  /** Channel name -> slot, only for channels this rig can move. */
  indices: { [channel: string]: number };
  /** Per mesh, slot -> morph target index on that mesh, or -1. */
  slots: number[][];
  /** Slots with no morph target on any mesh; the head bone carries them. */
  virtual: Set<number>;
  /** Slot -> other slots aliased onto the same morph target (21 visemes onto 15). */
  shared: Map<number, number[]>;
}

/** "AK_18_JawOpen" -> "jawOpen"; other names pass through. */
export function canonicalName(name: string): string {
  const ak = /^AK_\d+_(.+)$/.exec(name);
  return ak ? ak[1][0].toLowerCase() + ak[1].slice(1) : name;
}

function oculusSuffix(name: string): string | undefined {
  return /^(?:AA_VI_\d+_|viseme_)(.+)$/.exec(name)?.[1].toLowerCase();
}

export function resolveRig(
  dictionaries: { [name: string]: number }[],
  defaults: { [channel: string]: number },
  hasHeadBone: boolean
): Rig {
  const named = dictionaries.map((dict) => {
    const byName: { [channel: string]: number } = {};
    Object.entries(dict).forEach(([name, index]) => (byName[canonicalName(name)] = index));
    return byName;
  });

  // A GLB without targetNames gets "0", "1", ... from three.js; trust the table.
  if (!named.some((byName) => Object.keys(defaults).some((channel) => channel in byName))) {
    const size = Math.max(...Object.values(defaults)) + 1;
    return {
      indices: { ...defaults },
      slots: dictionaries.map(() => Array.from({ length: size }, (_, i) => i)),
      virtual: new Set(),
      shared: new Map(),
    };
  }

  const channels: string[] = [];
  Object.entries(defaults).forEach(([channel, slot]) => (channels[slot] = channel));
  named.forEach((byName) => Object.keys(byName).forEach((name) => {
    if (!channels.includes(name) && !oculusSuffix(name)) channels.push(name);
  }));

  const slots = dictionaries.map((dict, m) => channels.map((channel) => {
    if (channel in named[m]) return named[m][channel];
    const suffix = OCULUS_VISEMES[channel]?.toLowerCase();
    const alias = suffix && Object.keys(dict).find((name) => oculusSuffix(name) === suffix);
    return alias ? dict[alias] : -1;
  }));

  const indices: { [channel: string]: number } = {};
  const virtual = new Set<number>();
  channels.forEach((channel, slot) => {
    if (slots.some((row) => row[slot] >= 0)) indices[channel] = slot;
    else if (hasHeadBone && HEAD_CHANNELS.includes(channel)) {
      indices[channel] = slot;
      virtual.add(slot);
    }
  });

  const shared = new Map<number, number[]>();
  slots.forEach((row) => {
    const byTarget: { [index: number]: number[] } = {};
    row.forEach((index, slot) => index >= 0 && (byTarget[index] ??= []).push(slot));
    Object.values(byTarget).forEach((group) => group.length > 1 && group.forEach((slot) => {
      shared.set(slot, Array.from(new Set([...(shared.get(slot) ?? []), ...group.filter((s) => s !== slot)])));
    }));
  });
  return { indices, slots, virtual, shared };
}
