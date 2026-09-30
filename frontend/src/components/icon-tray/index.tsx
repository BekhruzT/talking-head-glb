import { AudioState, AvatarVoice } from "./audio";
import { Mic, MicState } from "./mic";

export interface IconTrayProps {
  audioUrl?: string;
  onAudioEnd?: () => void;
  onTranscription?: () => void;
  micState: MicState;
  setMicState: (state: MicState) => void;
  audioState: AudioState;
  setAudioState: (state: AudioState) => void;
  audioElRef?: { current: HTMLAudioElement | null };
}

export const IconTray = ({
  audioUrl,
  onAudioEnd,
  onTranscription,
  micState,
  setMicState,
  audioState, 
  setAudioState,
  audioElRef
}: IconTrayProps) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-evenly",
        position: "absolute",
        bottom: "1em",
        alignSelf: "center",
        width: "1em",
        gap: "1em"
      }}
    >
      <AvatarVoice
        url={audioUrl}
        state={audioState}
        setState={setAudioState}
        onEnd={onAudioEnd}
        elementRef={audioElRef}
      />
      <Mic
        state={micState}
        setState={setMicState}
        onTranscription={onTranscription}
      />
    </div>
  );
};
