import { useCallback, useEffect, useState } from "react";
import { MotionSettings, TalkingHead, Utterance } from "talking-head-glb";
import { download, installed, InstalledHead, listHeads } from "talking-head-glb/heads";
import { IconTray } from "./components";
import { MicState } from "./components/icon-tray/mic";
import { AudioState } from "./components/icon-tray/audio";
import { MotionControls } from "./components/motion-controls";
import { HeadPicker } from "./components/head-picker";

const BACKEND_ENDPOINT = import.meta.env.VITE_BACKEND_ENDPOINT;
// Eval switches, read once from the URL so a recording session can strip the
// avatar down to lip-sync without a rebuild or injected script:
//   ?noExpressions=1    no emotions, blinks, or gaze
//   ?noHeadMovement=1   no neck turn or head bob
//   ?model=<ref>        start on an installed head, e.g. rocketbox/medical-female-01
const evalFlags = new URLSearchParams(window.location.search);
const CATALOG = listHeads();

function App() {
  const [heads, setHeads] = useState<InstalledHead[]>();
  const [headRef, setHeadRef] = useState(evalFlags.get("model") ?? "ava/ava");
  const head = heads?.find((h) => h.ref === headRef) ?? heads?.find((h) => h.ref === "ava/ava") ?? heads?.[0];
  const modelAvailability = !heads ? "checking" : head ? "available" : "unavailable";
  const [downloads, setDownloads] = useState<Record<string, number | string>>({});
  const [motionSettings, setMotionSettings] = useState<MotionSettings>({
    headMovementEnabled: !evalFlags.has("noHeadMovement"),
    gazeEnabled: !evalFlags.has("noExpressions"),
    expressionsEnabled: !evalFlags.has("noExpressions"),
    blinkingEnabled: !evalFlags.has("noExpressions"),
  });
  const [speech, setSpeech] = useState<Utterance>();
  const [thinking, setThinking] = useState(false);
  const [micState, setMicState] = useState<MicState>(MicState.OFF);
  const [audioState, setAudioState] = useState<AudioState>(AudioState.ON);

  useEffect(() => {
    installed().then(setHeads);
  }, []);

  const onDownload = useCallback((ref: string) => {
    const progress = (value: number | string) => setDownloads((current) => ({ ...current, [ref]: value }));
    progress(0);
    download(ref, { onProgress: progress })
      .then(() => installed())
      .then((list) => {
        setHeads(list);
        setHeadRef(ref);
        setDownloads(({ [ref]: _done, ...rest }) => rest);
      })
      .catch((error: Error) => progress(error.message));
  }, []);

  const onUserMessage = useCallback((message?: string) => {
    if (!message) return;
    setThinking(true);
    const chatHistory = JSON.parse(sessionStorage.getItem("chatHistory") ?? "[]");
    chatHistory.push({ role: "user", content: message });
    fetch(BACKEND_ENDPOINT + "/tts", { method: "POST", body: JSON.stringify({ chat: true, messages: chatHistory }) })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `chat answered ${res.status}`);
        return data;
      })
      .then((data) => {
        setSpeech({ audio: data.audio, visemes: data.visemes, blendShapeFrames: data.blendShapeFrames, emotion: data.emotion });
        chatHistory.push({ role: "assistant", content: JSON.stringify({ text: data.text, emotion: data.emotion.trim().toLowerCase() }) });
        sessionStorage.setItem("chatHistory", JSON.stringify(chatHistory));
      })
      .catch((error) => console.error("chat failed:", error))
      .finally(() => setThinking(false));
  }, []);

  // The mic stays disabled while the avatar speaks, keeping the on/off choice for afterwards.
  const onSpeakingChange = useCallback((speaking: boolean) => {
    setMicState((state) => speaking
      ? (state === MicState.ON ? MicState.DISABLED_ON : state === MicState.OFF ? MicState.DISABLED_OFF : state)
      : (state === MicState.DISABLED_ON ? MicState.ON : state === MicState.DISABLED_OFF ? MicState.OFF : state));
  }, []);

  return (
    <>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundImage: `url(${'/office2.jpg'})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover',
            height: "100vh",
            width: "100vw",
            margin: "auto",
          }}
        >
          {head && (
            <TalkingHead
              key={head.ref}
              head={head.ref}
              speech={speech}
              thinking={thinking}
              motion={motionSettings}
              muted={audioState === AudioState.OFF}
              onSpeakingChange={onSpeakingChange}
              onError={(error) => console.error("speech failed:", error)}
            />
          )}
          {modelAvailability === "unavailable" && (
            <div role="alert" style={{ background: "rgba(255,255,255,0.94)", borderRadius: "12px", margin: "auto", maxWidth: "32rem", padding: "2rem" }}>
              <h1>No avatar installed</h1>
              <p>Download a head from the picker, or run <code>npm run heads -- add ava/ava</code> for Ava.</p>
            </div>
          )}
        </div>
      {heads && (
        <HeadPicker heads={CATALOG} installed={heads} selected={head?.ref} downloads={downloads} onSelect={setHeadRef} onDownload={onDownload} />
      )}
      {modelAvailability === "available" && (
        <MotionControls
          settings={motionSettings}
          onChange={(key, enabled) => setMotionSettings((current) => ({ ...current, [key]: enabled }))}
        />
      )}
      {modelAvailability === "available" && <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          margin: "auto",
          position: "absolute",
          bottom: '2em',
          right: '4em',
        }}
      >
        <IconTray
          onTranscription={onUserMessage}
          micState={micState}
          setMicState={setMicState}
          audioState={audioState}
          setAudioState={setAudioState}
        />
      </div>}
    </>
  );
}

export default App;
