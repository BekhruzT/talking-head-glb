import IconButton from "@mui/material/IconButton";
import { VolumeUp as VolumeUpIcon, VolumeOff as VolumeOffIcon } from "@mui/icons-material";

export enum AudioState {
  ON,
  OFF
}

export interface AvatarVoiceProps {
  state: AudioState;
  setState: (audioState: AudioState) => void;
}

export const AvatarVoice = ({ state, setState }: AvatarVoiceProps) => {
  const Icon = state === AudioState.OFF ? VolumeOffIcon : VolumeUpIcon;

  return (
    <IconButton
      style={{
        background: "#7070ff",
        color: "white",
        borderRadius: "100px",
        padding: 16,
        height: "2em",
        width: "2em",
        boxShadow:
            "0 8px 16px 0 rgba(0,0,0,0.2), 0 6px 20px 0 rgba(0,0,0,0.19)",
      }}
      onClick={() => setState(state === AudioState.ON ? AudioState.OFF : AudioState.ON)}
    >
      <Icon
        style={{
          height: "1.3em",
          width: "1.3em",
        }}
      />
    </IconButton>
  );
};
