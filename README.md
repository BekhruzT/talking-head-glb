# Talking Heads

Talking Heads is an interactive speaking-avatar prototype featuring Ava, a browser-rendered GLB avatar. Speak into your microphone and Ava answers with generated speech, lip sync, facial expressions, and head movement.

## Watch the same line two ways

**Ava**, the browser avatar, speaks the same seven-second line about becoming a marine biologist in both clips. Click either preview to watch with sound.

| Full animation | Lip sync only |
| --- | --- |
| [![Watch Ava speak with facial expressions and neck movement](docs/demo/marine-biologist.jpg)](https://github.com/BekhruzT/talking-head-glb/raw/refs/heads/main/docs/demo/marine-biologist.mp4) | [![Watch Ava speak with only lip sync](docs/demo/marine-biologist-lips-only.jpg)](https://github.com/BekhruzT/talking-head-glb/raw/refs/heads/main/docs/demo/marine-biologist-lips-only.mp4) |
| Facial expressions, blinks, gaze, and neck movement enabled. [Play with sound](https://github.com/BekhruzT/talking-head-glb/raw/refs/heads/main/docs/demo/marine-biologist.mp4). | Only speech-driven mouth motion. [Play with sound](https://github.com/BekhruzT/talking-head-glb/raw/refs/heads/main/docs/demo/marine-biologist-lips-only.mp4). |

These are recordings of the generated avatar output. The human reference recordings used for evaluation are not included.

## Try it locally

The code and video demos are public; Ava's GLB is distributed separately from the [private model repository](https://github.com/BekhruzT/talking-head-glb-model). If you need model access, [open an issue](https://github.com/BekhruzT/talking-head-glb/issues/new) with your GitHub username and intended use. The owner can approve access to that repository.

You need Node.js 22.18 or newer (Node 24 tested), npm, an Azure Speech key and region, and an OpenAI or Gemini API key. Ava also needs Git, Git LFS and GitHub CLI: sign in with `gh auth login` using the GitHub account that owns the model or has been invited to its private repository. If you are the owner and another account is active, run `gh auth switch --user BekhruzT` first. From the repository root, run:

```sh
npm install
git lfs install
npm run heads -- add ava/ava
```

`npm install` installs every workspace. The last command clones the model repository, checks the file's SHA-256 and installs it as `frontend/public/heads/ava.ava.glb`, a folder ignored by Git. If your account lacks access, it exits with an explanation; request access through the issue link above. Without Ava the app starts with the other heads you install, or tells you how to install one.

1. Copy `.env.template` to `.env` in the repository root. Set `SPEECH_KEY`, `SPEECH_REGION`, and either `OPENAI_API_KEY` or `GEMINI_API_KEY`.
2. Create `frontend/.env.local` with `VITE_BACKEND_ENDPOINT=http://localhost:4000`.
3. Start the backend in one terminal with `npm run dev -w backend`, and the frontend in another with `npm run dev -w frontend`.

Open [http://localhost:3000](http://localhost:3000) and use the microphone button to speak with Ava. Browser speech recognition must be available and microphone access allowed.

### Other heads (optional)

Any GLB with ARKit blendshapes can stand in for Ava; Rocketbox `AK_*` and Oculus viseme names are mapped automatically, and a head without neck shapes turns its head bone instead. The avatar picker at the top lists every known head: installed ones switch in, Rocketbox and MakeHuman heads have a Download button that saves them in the browser, and the others show their CLI command. `?model=<ref>` starts on an installed head.

```sh
npm run heads -- list                                  # every head, its licence, and whether it is installed
npm run heads -- add rocketbox/medical-male-01 mpfb/mpfb ict/ict-facekit
npm run heads -- remove mpfb/mpfb
```

| Provider | Heads | Licence |
| --- | --- | --- |
| Ava | `ava/ava` | Private, by approval ([model repository](https://github.com/BekhruzT/talking-head-glb-model)) |
| [USC ICT-FaceKit](https://github.com/ICT-VGL/ICT-FaceKit) | `ict/ict-facekit`, converted locally | MIT, Copyright (c) 2020 USC Institute for Creative Technologies |
| [MakeHuman / MPFB](https://github.com/met4citizen/TalkingHead) | `mpfb/mpfb` | CC0-1.0 |
| [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) | `rocketbox/<id>`, any id in the [dataset](https://huggingface.co/datasets/codepawl/rocketbox-avatars-glb/tree/main/objects) | MIT, Copyright (c) 2020 Microsoft. Gonzalez-Franco et al., The Rocketbox library and the utility of freely available rigged avatars, Frontiers in Virtual Reality 2020, doi:10.3389/frvir.2020.561558 |

Heads installed before the head library, under `frontend/public/models/`, are no longer read; add them again with the commands above.

## Project areas

- [`packages/talking-head/`](packages/talking-head/) — the [`talking-head-glb`](packages/talking-head/README.md) React package: the `<TalkingHead>` component, the head library and its CLI, and server-side speech.
- [`frontend/`](frontend/) — the viewer web app, a thin wrapper around the package with chat, microphone and avatar picker.
- [`backend/`](backend/) — chat and speech generation for Ava.
- [`infra/`](infra/) — optional AWS deployment for the web app and speech API.
- [`eval/`](eval/) — lip-sync evaluation and [methodology](eval/README.md).

## Licence

MIT, see [LICENSE](LICENSE). Each head keeps its own licence, listed above.
