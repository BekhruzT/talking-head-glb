import type { HeadSettings } from "../avatar";

export interface Provider {
  id: string;
  name: string;
  license: { name: string; url: string; credit?: string };
  /** Tested head ids and their labels. */
  heads: Record<string, string>;
  /** Where to find more ids; when set, any id matching ^[a-z0-9-]+$ is accepted. */
  catalog?: string;
  /** `{id}` in a url is replaced by the head id. Only url sources download in the browser. */
  source: { url: string } | { repo: string; path: string; sha256: string } | { build: "ict-facekit" };
  settings?: Record<string, HeadSettings>;
}

export const providers: Provider[] = [
  {
    id: "ava",
    name: "Ava",
    license: { name: "Private, by approval", url: "https://github.com/BekhruzT/talking-head-glb-model" },
    heads: { ava: "Ava" },
    source: { repo: "BekhruzT/talking-head-glb-model", path: "frontend/public/models/ava/ava.glb", sha256: "1821dabc3e0ab62359b7b07d9504970391398375421175cba0b6e5c0a9d45792" },
    settings: { ava: { position: [0, -1.72, 0] } },
  },
  {
    id: "ict",
    name: "ICT FaceKit",
    license: { name: "MIT", url: "https://github.com/ICT-VGL/ICT-FaceKit", credit: "Copyright (c) 2020 USC Institute for Creative Technologies" },
    heads: { "ict-facekit": "ICT FaceKit" },
    source: { build: "ict-facekit" },
  },
  {
    id: "mpfb",
    name: "MakeHuman",
    license: { name: "CC0-1.0", url: "https://github.com/met4citizen/TalkingHead" },
    heads: { mpfb: "MakeHuman" },
    source: { url: "https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/mpfb.glb" },
  },
  {
    id: "rocketbox",
    name: "Microsoft Rocketbox",
    license: { name: "MIT", url: "https://github.com/microsoft/Microsoft-Rocketbox", credit: "Copyright (c) 2020 Microsoft" },
    heads: { "medical-female-01": "Medical female 01", "medical-male-01": "Medical male 01", "business-female-02": "Business female 02", "business-male-03": "Business male 03" },
    catalog: "https://huggingface.co/datasets/codepawl/rocketbox-avatars-glb/tree/main/objects",
    source: { url: "https://huggingface.co/datasets/codepawl/rocketbox-avatars-glb/resolve/main/objects/{id}/{id}.glb" },
  },
];
