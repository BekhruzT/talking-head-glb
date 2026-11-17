import { GlbAvatar, VisemeData } from "./glb-avatar";
import { expressions, blendShapeIndices, randomExpressions, headMovements, ChatStatus } from "./animations";
import { MotionSettings } from "./motion-settings";

// Per-head framing and neck strength; omitted fields use Ava's values.
export interface HeadSettings {
  // Omit to frame the model on its head bone.
  position?: [number, number, number];
  headOffset?: number;
  neck?: { pitch: number; yaw: number };
  camera?: { position: [number, number, number]; fov: number };
}

interface AvatarProps extends MotionSettings {
  src: string;
  settings: HeadSettings;
  status: ChatStatus;
  audioElRef: { current: HTMLAudioElement | null };
  visemes?: VisemeData[];
  blendShapeFrames?: number[][];
}

/** Renders a GLB head with Ava's animation tables and the head's settings. */
export const Avatar = ({ src, settings, status, ...rest }: AvatarProps) => (
  <GlbAvatar
    {...rest}
    src={src}
    expressions={expressions}
    headMovements={headMovements}
    blendShapeIndices={blendShapeIndices}
    randomExpressions={randomExpressions}
    position={settings.position}
    // Neck radians per unit of Ava's neck shapes, so the same channel values turn a bone-rigged head as far.
    neck={settings.neck ?? { pitch: 0.5, yaw: 0.87 }}
    headOffset={settings.headOffset ?? -0.09}
    rotation={[0, 0, 0]}
    currentChatStatus={status}
    camera={settings.camera ?? { position: [0, 0, 0.68], fov: 31 }}
  />
);

export type { VisemeData };
