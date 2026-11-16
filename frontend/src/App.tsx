import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, IconTray, VisemeData } from "./components";
import { MicState } from "./components/icon-tray/mic";
import { AudioState } from "./components/icon-tray/audio";
import { MotionControls } from "./components/motion-controls";
import { HeadPicker } from "./components/head-picker";
import { MotionSettings } from "./components/avatar/motion-settings";

import { ChatStatus } from './components/avatar/animations';

const BACKEND_ENDPOINT = process.env.REACT_APP_BACKEND_ENDPOINT!;
// Eval switches, read once from the URL so a recording session can strip the
// avatar down to lip-sync without a rebuild or injected script:
//   ?noExpressions=1    no emotions, blinks, or gaze
//   ?noHeadMovement=1   no neck turn or head bob
//   ?model=<name>       start on any GLB under public/models/rocketbox/ instead of Ava
const evalFlags = new URLSearchParams(window.location.search);

interface Head {
  id: string;
  label: string;
  path: string;
  position?: [number, number, number];
}
const rocketbox = (id: string): Head => ({
  id,
  label: id[0].toUpperCase() + id.slice(1).replace(/-/g, " "),
  path: `/models/rocketbox/${id}.glb`,
});
const REQUESTED = evalFlags.get("model")?.replace(/[^\w-]/g, "");
const KNOWN = ["medical-female-01", "medical-male-01", "business-female-02", "business-male-03"];
// The Rocketbox heads are optional downloads, so the picker shows whichever are present.
const HEADS: Head[] = [
  { id: "ava", label: "Ava", path: "/models/ava/ava.glb", position: [0, -1.72, 0] },
  { id: "ict-facekit", label: "ICT FaceKit", path: "/models/ict/ict-facekit.glb" },
  { id: "mpfb", label: "MakeHuman", path: "/models/mpfb/mpfb.glb" },
  ...[...KNOWN, ...(REQUESTED && !KNOWN.includes(REQUESTED) && REQUESTED !== "ict-facekit" ? [REQUESTED] : [])].map(rocketbox),
];

export interface Media {
  audio: string;
  visemes: VisemeData[];
  blendShapeFrames?: number[][];
  text?: string;
  emotion: string;
}

function App() {
  const [availableHeads, setAvailableHeads] = useState<Head[]>();
  const [headId, setHeadId] = useState(REQUESTED ?? "ava");
  const head = availableHeads?.find((h) => h.id === headId) ?? availableHeads?.[0];
  const modelAvailability = !availableHeads ? "checking" : head ? "available" : "unavailable";
  const [motionSettings, setMotionSettings] = useState<MotionSettings>({
    headMovementEnabled: !evalFlags.has("noHeadMovement"),
    gazeEnabled: !evalFlags.has("noExpressions"),
    expressionsEnabled: !evalFlags.has("noExpressions"),
    blinkingEnabled: !evalFlags.has("noExpressions"),
  });
  const [audioUrl, setAudioUrl] = useState<string>();
  const [currentChatStatus, setCurrentChatStatus] = useState<ChatStatus>(ChatStatus.IDLE);
  const [visemes, setVisemes] = useState<VisemeData[]>();
  const [blendShapeFrames, setBlendShapeFrames] = useState<number[][]>();

  const [micState, setMicState] = useState<MicState>(MicState.OFF);
  const [mediaQueue, setMediaQueue] = useState<Media[]>([]);
  const [audioState, setAudioState] = useState<AudioState>(AudioState.ON);

  // Owned here so the avatar's lip-sync and the voice share one playback clock.
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // The dev server answers a missing file with index.html, so a 200 alone proves nothing.
    const exists = (head: Head) =>
      fetch(head.path, { method: "HEAD", signal: controller.signal })
        .then((response) => response.ok && !response.headers.get("content-type")?.toLowerCase().includes("text/html"))
        .catch(() => false);
    Promise.all(HEADS.map(exists)).then((found) => {
      if (!controller.signal.aborted) setAvailableHeads(HEADS.filter((_, i) => found[i]));
    });
    return () => controller.abort();
  }, []);

  const cleanUpAudio = useCallback((base64Audio: string) => {
    let audio = base64Audio;
    // remove padding from last
    audio = audio.replaceAll(
      /q+(\/\/NI.{14}q+pMQU1FMy4xMDCq+)+\/\/NI.{14}q+$/g,
      ""
    );
    audio = audio.replaceAll(
      /V+(\/\/NI.{14}V+MQU1FMy4xMDBV+)+\/\/NI.{14}V+$/g,
      ""
    );
    return audio;
  }, []);

  const onUserMessage = useCallback((message?: string) => {
    if (message) {
      setCurrentChatStatus((status: ChatStatus) => {
        if (status === ChatStatus.IDLE) { return ChatStatus.SENT }
        else { return status }
      })
      let chatHistory = JSON.parse(sessionStorage.getItem("chatHistory") ?? '[]')
      chatHistory.push({ "role": "user", "content": message });

      fetch(BACKEND_ENDPOINT + "/tts", {
        method: "POST",
        body: JSON.stringify({ chat: true, messages: chatHistory }),
      })
        .then((res) => res.json())
        .then((data) => {
          setMediaQueue((mediaQueue) => [
            ...mediaQueue,
            { ...data },
          ]);

          chatHistory.push({ "role": "assistant", "content": JSON.stringify({ "text": data.text, "emotion": data.emotion.trim().toLowerCase() }) })
          sessionStorage.setItem("chatHistory", JSON.stringify(chatHistory));
        });
    }
  }, []);

  const processQueue = () => {
    if (mediaQueue?.length) { // there is speech enqueued. bot speech is disabled
      if (micState === MicState.ON) setMicState(MicState.DISABLED_ON);
      else if (micState === MicState.OFF) setMicState(MicState.DISABLED_OFF);
    } else if (!audioUrl) { // there is no audio playing. bot speech is enabled.
      if (micState === MicState.DISABLED_ON) setMicState(MicState.ON);
      else if (micState === MicState.DISABLED_OFF) setMicState(MicState.OFF);
    }

    if (mediaQueue?.length && !audioUrl) { // start media play if any enqueued and no audio playing
      const { audio, visemes, emotion, blendShapeFrames } = mediaQueue.shift()!;
      setAudioUrl("data:audio/mp3;base64," + cleanUpAudio(audio));
      setVisemes(visemes);
      setBlendShapeFrames(blendShapeFrames);
      const em = emotion.trim().toLowerCase()

      if (em === 'happy')
        setCurrentChatStatus(ChatStatus.RESPONDINGHAPPY);
      else if (em === 'empathetic')
        setCurrentChatStatus(ChatStatus.RESPONDINGSAD);
      else if (em === 'excited')
        setCurrentChatStatus(ChatStatus.RESPONDINGSURPRISED);
      else
        setCurrentChatStatus(ChatStatus.RESPONDINGNEUTRAL);
    }
    else if (!mediaQueue?.length && !audioUrl) { // no media playing or enqueued => initiate idle
      setCurrentChatStatus(ChatStatus.IDLE);
    }
  };

  useEffect(() => {
    processQueue();
  }, [mediaQueue, audioUrl]); // eslint-disable-line

  const onAudioEnd = useCallback(() => {
    setAudioUrl(undefined);
  }, [setAudioUrl]);

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
            <Avatar
              key={head.id}
              modelPath={head.path}
              position={head.position}
              visemes={visemes}
              currentChatStatus={currentChatStatus}
              audioElRef={audioElRef}
              blendShapeFrames={blendShapeFrames}
              {...motionSettings}
            />
          )}
          {modelAvailability === "unavailable" && (
            <div role="alert" style={{ background: "rgba(255,255,255,0.94)", borderRadius: "12px", margin: "auto", maxWidth: "32rem", padding: "2rem" }}>
              <h1>Ava's model is unavailable</h1>
              <p>Run <code>npm run setup:model</code> from the repository root after your GitHub account has access to the private model.</p>
              <a href="https://github.com/BekhruzT/talking-head-glb/issues/new">Request access</a>
            </div>
          )}
        </div>
      {head && availableHeads!.length > 1 && (
        <HeadPicker heads={availableHeads!} selected={head.id} onSelect={setHeadId} />
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
          audioUrl={audioUrl}
          onTranscription={onUserMessage}
          onAudioEnd={onAudioEnd}
          micState={micState}
          setMicState={setMicState}
          audioState={audioState}
          setAudioState={setAudioState}
          audioElRef={audioElRef}
        />
      </div>}
    </>
  );
}

export default App;
