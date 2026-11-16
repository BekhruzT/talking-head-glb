import { GlbAvatar, VisemeData } from "./glb-avatar";
import {
  expressions,
  blendShapeIndices,
  randomExpressions,
  headMovements
} from "./animations";
import { ChatStatus } from './animations'

// Per-head overrides from public/models/<family>/family.json.
export interface HeadSettings {
  // Omit to frame the model on its head bone.
  position?: [number, number, number];
  headOffset?: number;
  neck?: { pitch: number; yaw: number };
  camera?: { position: [number, number, number]; fov: number };
}

export interface AvatarProps {
  modelPath: string;
  settings?: HeadSettings;
  visemes?: VisemeData[];
  currentChatStatus: ChatStatus
  audioElRef?: { current: HTMLAudioElement | null };
  blendShapeFrames?: number[][];
  expressionsEnabled?: boolean;
  headMovementEnabled?: boolean;
  gazeEnabled?: boolean;
  blinkingEnabled?: boolean;
}

export const Avatar = ({ modelPath, settings = {}, visemes, currentChatStatus, audioElRef, blendShapeFrames, expressionsEnabled, headMovementEnabled, gazeEnabled, blinkingEnabled }: AvatarProps) => {
  return (
    <GlbAvatar
      src={modelPath}
      audioElRef={audioElRef}
      blendShapeFrames={blendShapeFrames}
      expressionsEnabled={expressionsEnabled}
      headMovementEnabled={headMovementEnabled}
      gazeEnabled={gazeEnabled}
      blinkingEnabled={blinkingEnabled}
      expressions={expressions}
      headMovements={headMovements}
      blendShapeIndices={blendShapeIndices}
      randomExpressions={randomExpressions}
      visemes={visemes}
      position={settings.position}
      // Neck radians per unit of Ava's neck shapes, so the same channel values turn a bone-rigged head as far.
      neck={settings.neck ?? { pitch: 0.5, yaw: 0.87 }}
      headOffset={settings.headOffset ?? -0.09}
      rotation={[0, 0, 0]}
      currentChatStatus={currentChatStatus}
      camera={settings.camera ?? { position: [0, 0, 0.68], fov: 31 }}
    />
  );
};

export type { VisemeData };
