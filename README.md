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

You need Node.js 22.18 or newer (Node 24 tested), npm, Git, Git LFS, GitHub CLI, an Azure Speech key and region, and an OpenAI API key. Sign in with `gh auth login` using the GitHub account that owns the model or has been invited to its private repository. If you are the owner and another account is active, run `gh auth switch --user BekhruzT` first. From the repository root, run:

```sh
git lfs install
npm run setup:model -- ava
```

The command verifies the model and installs it at `frontend/public/models/ava/ava.glb`. The path is ignored by Git. If your account lacks access, setup exits with an explanation and leaves the model uninstalled; request access through the issue link above. A public clone can start the web app without the model, but the app will show setup instructions instead of Ava until this step succeeds.

1. Copy `.env.template` to `.env` in the repository root. Set `SPEECH_KEY`, `SPEECH_REGION`, and either `OPENAI_API_KEY` or `GEMINI_API_KEY`.
2. Create `frontend/.env.local` with `REACT_APP_BACKEND_ENDPOINT=http://localhost:4000`.
3. Start the backend in one terminal:

   ```sh
   cd backend
   npm install
   npm run dev
   ```

4. Start the frontend in another terminal:

   ```sh
   cd frontend
   npm install
   npm start
   ```

Open [http://localhost:3000](http://localhost:3000) and use the microphone button to speak with Ava. Browser speech recognition must be available and microphone access allowed.

### Other heads (optional)

Any GLB with ARKit blendshapes can stand in for Ava; Rocketbox `AK_*` and Oculus viseme names are mapped automatically, and a head without neck shapes turns its head bone instead. Each folder under `frontend/public/models/` has a `family.json` with its download source and per-head overrides. Setup installs the heads you name, then lists every GLB on disk in `frontend/public/models/heads.json`, which the app loads; `?model=<id>` starts on one.

```sh
# MakeHuman / MPFB (CC0), USC ICT-FaceKit (MIT, built locally), and Microsoft Rocketbox (MIT) heads by id
npm run setup:model -- mpfb ict rocketbox=medical-female-01,medical-male-01,business-female-02,business-male-03
```

Rocketbox ids are listed in the [dataset](https://huggingface.co/datasets/codepawl/rocketbox-avatars-glb/tree/main/objects); the four above are tested, and only the human avatars have faces to animate.

## Project areas

- [`frontend/`](frontend/) — React web app and browser avatar.
- [`backend/`](backend/) — chat and speech generation for Ava.
- [`infra/`](infra/) — optional AWS deployment for the web app and speech API.
- [`eval/`](eval/) — lip-sync evaluation and [methodology](eval/README.md).
