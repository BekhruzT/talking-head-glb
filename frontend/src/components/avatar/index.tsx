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
  visemes?: VisemeData[];
  currentChatStatus: ChatStatus
  audioElRef?: { current: HTMLAudioElement | null };
  blendShapeFrames?: number[][];
  expressionsEnabled?: boolean;
  headMovementEnabled?: boolean;
}

export const Avatar = ({ modelPath, visemes, currentChatStatus, audioElRef, blendShapeFrames, expressionsEnabled, headMovementEnabled }: AvatarProps) => {
  return (
    <GlbAvatar
      src={modelPath}
      audioElRef={audioElRef}
      blendShapeFrames={blendShapeFrames}
      expressionsEnabled={expressionsEnabled}
      headMovementEnabled={headMovementEnabled}
      expressions={expressions}
      headMovements={headMovements}
      blendShapeIndices={blendShapeIndices}
      randomExpressions={randomExpressions}
      visemes={visemes}
      position={[0, -1.72, 0]}
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
