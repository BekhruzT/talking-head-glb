import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, IconTray, VisemeData } from "./components";
import { MicState } from "./components/icon-tray/mic";
import { AudioState } from "./components/icon-tray/audio";

import { ChatStatus } from './components/avatar/animations';

const BACKEND_ENDPOINT = process.env.REACT_APP_BACKEND_ENDPOINT!;

// Eval switches, read once from the URL so a recording session can strip the
// avatar down to lip-sync without a rebuild or injected script:
//   ?noExpressions=1    no emotions, blinks, gaze darts or brow/cheek bursts
//   ?noHeadMovement=1   no neck turn or head bob
const evalFlags = new URLSearchParams(window.location.search);

export interface Media {
  audio: string;
  visemes: VisemeData[];
  blendShapeFrames?: number[][];
  text?: string;
  emotion: string;
}

function App() {
  const [audioUrl, setAudioUrl] = useState<string>();
  const [currentChatStatus, setCurrentChatStatus] = useState<ChatStatus>(ChatStatus.IDLE);
  const [visemes, setVisemes] = useState<VisemeData[]>();
  const [blendShapeFrames, setBlendShapeFrames] = useState<number[][]>();

  const [micState, setMicState] = useState<MicState>(MicState.OFF);
  const [mediaQueue, setMediaQueue] = useState<Media[]>([]);
  const [audioState, setAudioState] = useState<AudioState>(AudioState.ON);

  // Owned here so the avatar's lip-sync and the voice share one playback clock.
  const audioElRef = useRef<HTMLAudioElement | null>(null);

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
          <Avatar modelPath="/models/ava/ava.glb" visemes={visemes} currentChatStatus={currentChatStatus} audioElRef={audioElRef} blendShapeFrames={blendShapeFrames} expressionsEnabled={!evalFlags.has("noExpressions")} headMovementEnabled={!evalFlags.has("noHeadMovement")} />
        </div>
      <div
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
      </div>
    </>
  );
}

export default App;
