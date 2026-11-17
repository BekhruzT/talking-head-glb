import { AudioState, AvatarVoice } from "./audio";
import { Mic, MicState } from "./mic";

export interface IconTrayProps {
  onTranscription?: (message?: string) => void;
  micState: MicState;
  setMicState: (state: MicState) => void;
  audioState: AudioState;
  setAudioState: (state: AudioState) => void;
}

export const IconTray = ({
  onTranscription,
  micState,
  setMicState,
  audioState,
  setAudioState,
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
        state={audioState}
        setState={setAudioState}
      />
      <Mic
        state={micState}
        setState={setMicState}
        onTranscription={onTranscription}
      />
    </div>
  );
};
