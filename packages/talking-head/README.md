# talking-head-glb

A React talking head for any GLB with ARKit blendshapes. Give it an utterance and it speaks it with lip sync, expressions, blinks, gaze and neck movement. A head library lists, installs and downloads heads.

```sh
npm install talking-head-glb react react-dom three @react-three/fiber @react-three/drei
```

## The component

```tsx
import { TalkingHead, httpTts } from "talking-head-glb";

<TalkingHead
  head="rocketbox/medical-female-01" // an installed head ref, or any GLB URL
  speech={utterance}                 // each new object is queued and spoken in order
  tts={httpTts("/api/tts")}          // only needed for text utterances
  thinking={waitingForReply}         // the "message sent" pose
  muted={false}
  onSpeakingChange={(speaking) => {}}
  onError={(error) => {}}
/>;
```

Other props: `settings` overrides the head's framing (`position`, `headOffset`, `neck`, `camera`), `motion` turns `headMovementEnabled`, `gazeEnabled`, `expressionsEnabled` and `blinkingEnabled` off one by one, and `headsDir` says where the CLI put heads (default `/heads`).

## Utterances and the speech connector

An utterance is either text or ready audio:

```ts
type Utterance =
  | { text: string; emotion?: Emotion }
  | { audio: string | Blob; visemes?: VisemeData[]; blendShapeFrames?: number[][]; emotion?: Emotion };
type Emotion = "neutral" | "happy" | "empathetic" | "excited";
```

- `audio` is base64 mp3, a `data:` or `https:` URL, or a Blob. It must come with `visemes` or `blendShapeFrames` (60fps, Azure's 55 ARKit channels), or it is refused through `onError`.
- Text goes through the `tts` prop: `(request: { text, emotion }) => Promise<{ audio, visemes?, blendShapeFrames? }>`. `httpTts(url)` POSTs `{ text, emotion }` as a JSON string with no content type, so cross-origin calls skip the CORS preflight, and expects that shape back.

On the server, `talking-head-glb/server` produces that shape with Azure Speech. Keep the key on the server:

```ts
import { synthesize } from "talking-head-glb/server";

const speech = await synthesize({ text, emotion }, { key: process.env.SPEECH_KEY, region: process.env.SPEECH_REGION });
// { audio, visemes, blendShapeFrames, words }
```

## Heads

A head ref is `<provider>/<head>`. `talking-head-glb/heads` knows these providers:

| Provider | Heads | Licence | Install |
| --- | --- | --- | --- |
| `ava` | `ava` | Private, by approval ([repo](https://github.com/BekhruzT/talking-head-glb-model)) | CLI (`gh` and Git LFS) |
| `ict` | `ict-facekit` | MIT, Copyright (c) 2020 USC Institute for Creative Technologies | CLI (built locally) |
| `mpfb` | `mpfb` | CC0-1.0 | browser or CLI |
| `rocketbox` | 4 tested, or [any id in the dataset](https://huggingface.co/datasets/codepawl/rocketbox-avatars-glb/tree/main/objects) | MIT, Copyright (c) 2020 Microsoft | browser or CLI |

In the browser:

```ts
import { download, installed, listHeads, remove } from "talking-head-glb/heads";

listHeads();                                  // [{ ref, provider, label, license, browser }]
await download("rocketbox/business-male-03", { onProgress: (fraction) => {} }); // into Cache Storage
await installed();                            // [{ ref, label, url, where: "browser" | "disk", settings }]
await remove("rocketbox/business-male-03");   // browser cache only
```

On disk, the CLI writes one flat folder of `<provider>.<head>.glb` files plus `heads.json`, which `installed()` reads from `headsDir`:

```sh
npx talking-head-glb heads list
npx talking-head-glb heads add ava/ava rocketbox/medical-male-01 --dir public/heads
npx talking-head-glb heads remove rocketbox/medical-male-01 --dir public/heads
```

Every download must be HTTPS and start with the GLB magic bytes; Ava's file is also checked against its SHA-256.

## Adding a provider

A provider is one object. Register it at runtime:

```ts
import { registerProvider } from "talking-head-glb/heads";

registerProvider({
  id: "acme",
  name: "Acme",
  license: { name: "MIT", url: "https://example.com/license" },
  heads: { robot: "Robot" },
  source: { url: "https://example.com/heads/{id}.glb" }, // needs CORS for browser downloads
});
```

To ship it with the package, add the same object to `src/heads/catalog.ts`. A `catalog` URL makes any id under the provider valid, and `settings` sets per-head framing.

## Licence

MIT. Each head keeps its own licence, listed above.
