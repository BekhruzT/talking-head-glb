import { GlbAvatar, VisemeData } from "./glb-avatar";
import {
  expressions,
  blendShapeIndices,
  randomExpressions,
  headMovements
} from "./animations";
import { ChatStatus } from './animations'

export interface AvatarProps {
  modelPath: string;
  // Omit to frame the model on its head bone.
  position?: [number, number, number];
  visemes?: VisemeData[];
  currentChatStatus: ChatStatus
  audioElRef?: { current: HTMLAudioElement | null };
  blendShapeFrames?: number[][];
  expressionsEnabled?: boolean;
  headMovementEnabled?: boolean;
  gazeEnabled?: boolean;
  blinkingEnabled?: boolean;
}

export const Avatar = ({ modelPath, position, visemes, currentChatStatus, audioElRef, blendShapeFrames, expressionsEnabled, headMovementEnabled, gazeEnabled, blinkingEnabled }: AvatarProps) => {
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
      position={position}
      rotation={[0, 0, 0]}
      currentChatStatus={currentChatStatus}
      camera={{
        position: [0, 0, 0.68],
        fov: 31,
      }}
    />
  );
};

export type { VisemeData };
