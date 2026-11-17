/* eslint-disable */
import {
  Suspense,
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, useGLTF, Html } from "@react-three/drei";
import { Euler, Quaternion, Vector3 } from "three";
import { ChatStatus } from "./animations";
import { resolveRig } from "./rig";
import { lipsyncTime } from "./lipsync-clock";
import { AZURE_BLENDSHAPE_NAMES, SPEECH_CHANNEL_NAMES, normalizeFrames, sampleFrame } from "./blendshape-stream";
import { ambientMotionEnabled, motionChannel, MotionSettings } from "./motion-settings";

export type VisemeId =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21;

export interface VisemeData {
  audioOffset: number;
  visemeId: VisemeId;
  // animation?: string | null;
}

export interface GlbAvatarProps {
  src: string;
  expressions: { [key: string]: any };
  headMovements: { [key: string]: any };
  blendShapeIndices: { [key: string]: number };
  randomExpressions: string[];
  camera?: any;
  position?: any;
  neck: { pitch: number; yaw: number };
  // Added to the height of a model auto-placed on its head bone.
  headOffset: number;
  rotation?: any;
  visemes?: VisemeData[];
  abortLipsync?: boolean;
  currentChatStatus: ChatStatus;
  setFps?: (fps: number) => void;
  audioElRef?: { current: HTMLAudioElement | null };
  // Azure FacialExpression stream. When present it drives the articulators
  // directly and the viseme-id scheduler below is bypassed.
  blendShapeFrames?: number[][];
  // Eval switches. The idle layer (emotions, blinks, gaze darts, brow/cheek
  // bursts) and the neck run on their own timers, independent of speech, so a
  // recording of a 12s utterance catches whichever of them happened to fire.
  // Turning them off leaves the mouth as the only thing moving.
  expressionsEnabled?: boolean;
  headMovementEnabled?: boolean;
  gazeEnabled?: boolean;
  blinkingEnabled?: boolean;
}

function getBlendShapesAzure(visemes: any) {
  const visemeMapAzure = { 0: "mouthClose", 1: "ae_ax_ah_01", 2: "aa_02", 3: "ao_03", 4: "ey_eh_uh_04", 5: "er_05", 6: "y_iy_ih_ix_06", 7: "w_uw_07", 8: "ow_08", 9: "aw_09", 10: "oy_10", 11: "ay_11", 12: "h_12", 13: "r_13", 14: "l_14", 15: "s_z_15", 16: "sh_ch_jh_zh_16", 17: "th_dh_17", 18: "f_v_18", 19: "d_t_n_19", 20: "k_g_ng_20", 21: "p_b_m_21", };
  let mappedBlendshapes: any[] = [];
  visemes.forEach((visemeData: VisemeData) => {
    let mappedBlendshape = visemeMapAzure[visemeData.visemeId];

    if (visemeMapAzure[visemeData.visemeId]) {
      mappedBlendshapes.push({
        time: visemeData.audioOffset / 10000,
        type: "blendshape",
        value: mappedBlendshape,
      });
    } else {
      console.warn("viseme not found", visemeData);
    }
  });
  return mappedBlendshapes;
}

const interpolationFunctions = {
  lerp: (start: number, end: number, t: number) => end * t + start * (1 - t),
  easeOutQuart: (start: number, end: number, t: number) =>
    end * (1 - (1 - t) ** 4) + start * (1 - t) ** 4,
  easeOutQuad: (start: number, end: number, t: number) =>
    end * (1 - (1 - t) ** 2) + start * (1 - t) ** 2,
  easeOutExpo: (start: number, end: number, t: number) =>
    end * (-Math.pow(2, -10 * t) + 1) + start * Math.pow(2, -10 * t),
  easeInQuad: (start: number, end: number, t: number) =>
    end * t ** 2 + start * (1 - t) ** 2,
};

function randomDuration(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

const HEAD_BONE = /(^|[\s_:])head$/i;

const Model = ({
  src,
  expressions,
  headMovements,
  blendShapeIndices: defaultIndices,
  randomExpressions,
  position,
  neck,
  headOffset,
  rotation,
  visemes,
  currentChatStatus,
  abortLipsync,
  setFps,
  audioElRef,
  blendShapeFrames,
  expressionsEnabled = true,
  headMovementEnabled = true,
  gazeEnabled = true,
  blinkingEnabled = true
}: GlbAvatarProps) => {
  const fpsRef = useRef<number>(0);

  const [animations, setAnimations] = useState<{ [key: string]: any }>({});
  const currentExpressionRef = useRef("null");
  const currentHeadMovementRef = useRef("null");
  const lastHeadMovementTimeRef = useRef<{[key: string]: number}>({"lastRandomRun": 0, "lastLookOutRun": 0})
  const motionRef = useRef<MotionSettings>({ headMovementEnabled, gazeEnabled, expressionsEnabled, blinkingEnabled });
  motionRef.current = { headMovementEnabled, gazeEnabled, expressionsEnabled, blinkingEnabled };
  const previousMotionRef = useRef(motionRef.current);

  const [animationEnds, setAnimationEnds] = useState(0);

  const { nodes, scene }: any = useGLTF(src);

  const morphMeshes: any[] = useMemo(
    () =>
      Object.values(nodes).filter(
        (node: any) => node.isMesh && node.morphTargetInfluences
      ),
    [nodes]
  );

  // A boneless head-only model (ICT-FaceKit) names a plain pivot node Head instead.
  const headBone: any = useMemo(() => {
    const all: any[] = Object.values(nodes);
    return all.find((node) => node.isBone && HEAD_BONE.test(node.name))
      ?? (all.some((node) => node.isBone) ? undefined : all.find((node) => !node.isMesh && HEAD_BONE.test(node.name)));
  }, [nodes]);

  const rig = useMemo(
    () => resolveRig(morphMeshes.map((mesh) => mesh.morphTargetDictionary ?? {}), defaultIndices, !!headBone),
    [morphMeshes, defaultIndices, headBone]
  );
  const blendShapeIndices = rig.indices;
  // Own value of each slot the mesh cannot hold alone: bone-driven slots, and
  // slots sharing a morph target, which shows the strongest of them.
  const slotValuesRef = useRef<{ [slot: number]: number }>({});
  const headTurnRef = useRef({ rest: null as Quaternion | null, parent: new Quaternion(), delta: new Quaternion(), euler: new Euler() });

  const readInfluence = useCallback((slot: number): number => {
    if (rig.virtual.has(slot) || rig.shared.has(slot)) return slotValuesRef.current[slot] ?? 0;
    for (let m = 0; m < morphMeshes.length; m++) {
      const index = rig.slots[m][slot];
      if (index >= 0) return morphMeshes[m].morphTargetInfluences[index];
    }
    return 0;
  }, [morphMeshes, rig]);

  const writeInfluence = useCallback((slot: number, value: number) => {
    const own = slotValuesRef.current;
    const siblings = rig.shared.get(slot);
    if (rig.virtual.has(slot) || siblings) own[slot] = value;
    morphMeshes.forEach((mesh, m) => {
      const index = rig.slots[m][slot];
      if (index < 0) return;
      mesh.morphTargetInfluences[index] = siblings
        ? Math.max(value, ...siblings.filter((s) => rig.slots[m][s] === index).map((s) => own[s] ?? 0))
        : value;
    });
  }, [morphMeshes, rig]);

  // Without an explicit placement, stand the model so its head sits where
  // Ava's does in front of the default camera.
  const placement = useMemo(() => {
    if (position || !headBone) return position;
    scene.updateMatrixWorld(true);
    const head = scene.worldToLocal(headBone.getWorldPosition(new Vector3()));
    return [-head.x, -head.y + headOffset, -head.z];
  }, [position, headBone, scene, headOffset]);

  useEffect(() => {
    const probe = new URLSearchParams(window.location.search).has("probe");
    if (probe) (window as any).__avatar = { read: (name: string) => readInfluence(blendShapeIndices[name]), indices: blendShapeIndices, headBone, virtual: rig.virtual, rig, meshes: morphMeshes };
  }, [readInfluence, blendShapeIndices, headBone, rig, morphMeshes]);

  // [stream channel, morph target index, blendshape name] for the articulators.
  const speechChannels = useMemo(
    () =>
      SPEECH_CHANNEL_NAMES.map(
        (name) => [AZURE_BLENDSHAPE_NAMES.indexOf(name), blendShapeIndices[name], name] as [number, number, string]
      ).filter(([channel, morphIndex]) => channel >= 0 && morphIndex !== undefined),
    [blendShapeIndices]
  );
  const streamingRef = useRef(false);

  const speechFrames = useMemo(
    () => (blendShapeFrames?.length ? normalizeFrames(blendShapeFrames) : undefined),
    [blendShapeFrames]
  );

  useEffect(()=>{
    setInterval(()=>{
      if (setFps) setFps(fpsRef.current * 2)
      fpsRef.current = 0
    }, 500)
  }, [])

  const setLipsAnimation = useCallback((
    mapped_blendshape: any,
    startTime: number,
    duration: number,
    startValue: number,
    endValue: number,
    interpolation: string = "lerp",
    media: boolean = false
  ) => {
    /**
     * Enqueues a new animation.
     *
     * @function setLipsAnimation
     * @param {string} mapped_blendshape - The name of the blendshape to be animated
     * @param {number} startTime - The time at which the animation should start. Wall-clock ms, or an offset into the audio when media is true.
     * @param {number} duration - The duration of the animation in milliseconds.
     * @param {number} startValue - The starting value of the animation [0, 1]. 0 - blendshape is not triggered
     * @param {number} endValue - The ending value of the animation [0, 1]. 1 - maximum extent of the blendshape animation
     * @param {string} [interpolation='lerp'] - The type of interpolation to use for the animation, default is lerp (linear interpolation).
     * @param {boolean} [media=false] - Read startTime against the audio element's clock instead of wall time. Set for lip-sync so it cannot drift from the voice.
     */
    setAnimations((animations: { [key: string]: any }) => {
      const index = blendShapeIndices[mapped_blendshape];
      if (index === undefined) {
        console.warn(`blendshape not on the rig: ${mapped_blendshape}`);
        return animations;
      }
      animations[index.toString() + "#" + startTime.toString()] = {
        startValue,
        endValue,
        duration,
        interpolation,
        media,
      };
      return animations;
    });
  }, [setAnimations, blendShapeIndices]);

  useEffect(() => {
    const disabled = (Object.keys(motionRef.current) as (keyof MotionSettings)[])
      .filter((key) => previousMotionRef.current[key] && !motionRef.current[key]);
    if (disabled.length) {
      const indices = new Set(Object.entries(blendShapeIndices)
        .filter(([shape]) => disabled.includes(motionChannel(shape)))
        .map(([, index]) => index));
      const speechIndices = new Set(streamingRef.current
        ? speechChannels.map(([, morphIndex]) => morphIndex)
        : []);
      Object.entries(animations).forEach(([key, animation]) => {
        if (animation.media) speechIndices.add(Number(key.split("#")[0]));
      });
      setAnimations((current) => {
        const next = { ...current };
        Object.keys(next).forEach((key) => {
          if (!next[key].media && indices.has(Number(key.split("#")[0]))) delete next[key];
        });
        return next;
      });
      indices.forEach((index) => {
        if (!speechIndices.has(index)) writeInfluence(index, 0);
      });
      if (disabled.includes("expressionsEnabled")) currentExpressionRef.current = "";
      if (!headMovementEnabled && !gazeEnabled) currentHeadMovementRef.current = "";
    }
    previousMotionRef.current = motionRef.current;
  }, [headMovementEnabled, gazeEnabled, expressionsEnabled, blinkingEnabled, blendShapeIndices, writeInfluence, speechChannels, animations]);

  const animateLipSync = useCallback((mapped_blendshapes: any) => {
    /**
     * Animates lip sync by iterating through the mapped blendshapes and setting the corresponding lip animations.
     *
     * @function animateLipSync
     * @param {Array} mapped_blendshapes - an array of objects [{value: <blendshape name>, time: <offset time from audio start when the blendshape should be triggered> }].
     *
     * Start time of each blendshape - dictated by audio offset which is a relative time. Add current date - on reception of the visemes to get the absolute time.
     * Duration - the difference between the audio offset of current and next blendshapes. Animation of blendshape i ends at the start of the animation of blenshape i + 1
     * Start value - 0 for forwards animation and 1 for backwards animation
     * End value - 1 for forwards animation and 0 for backwards animation
     * Backwards animation - necessary to prevent the superposition of different blendshapes as otherwise leads to a distored face
     *                     - every blendshape i upon forwards completion is reverse to original state; the duration is dictated by the duration of the next blendshape i+1
     *                     - backwards animation of blendshape i runs concurrently with forwards animation of blendshape i + 1
     * Prevent run of mouthclose animation - distorts the face; there is already the backwards animation to close the mouth. Running close mouth => upper lip goes below lower lip
     * Interpolation - easeOutQuart - faster start then lerp -> more natural lip movement.
     */
    function dropSecondMouthClose(objects:any) {
      let previousType:any = null;
      return objects.filter((obj:any, index:any) => {
          if (obj.value === 'mouthClose' && previousType === 'mouthClose') {
              previousType = obj.value;
              return false;
          } else {
              previousType = obj.value;
              return true;
          }
      });
    }
    function dropQuickSounds(arr:any) {
      let lastDroppedIndex = -2;
      return arr.filter((item:any, index:any) => {
        if (index === 0) return true; // always keep the first item
        const prevItem = arr[index - 1];
        const nextItem = arr[index + 1];
        const diffWithPrev = item.time - prevItem.time;
        const diffWithNext = nextItem ? nextItem.time - item.time : Infinity;
        if (diffWithPrev + diffWithNext < 120 && lastDroppedIndex !== index - 1) {
          lastDroppedIndex = index;
          return false;
        }
        return true;
      });
      }
    const mapped_blendshapes_mouth = dropSecondMouthClose(mapped_blendshapes)
    mapped_blendshapes = dropQuickSounds(mapped_blendshapes_mouth)

    // Viseme offsets are positions in the audio, so schedule against the audio's
    // own clock (base 0) rather than wall time; see lipsync-clock.ts.
    const startTime = 0;
    if (mapped_blendshapes[0].value !== "mouthClose") {
      let duration = mapped_blendshapes[1].time - mapped_blendshapes[0].time;
      setLipsAnimation(mapped_blendshapes[0].value, startTime + mapped_blendshapes[0].time, duration, 0, 1, "easeOutQuad", true);
    }
    const dummy_duration = 200;
    let reverse = true
    for (let i = 1; i < mapped_blendshapes.length; i++) {
      const prev_mapped_blendshape = mapped_blendshapes[i - 1];
      const current_mapped_blendshape = mapped_blendshapes[i];

      const next_blendshape_time = mapped_blendshapes[i + 1]
        ? mapped_blendshapes[i + 1].time
        : current_mapped_blendshape.time + dummy_duration;
      const next_blendshape_name = mapped_blendshapes[i + 1]?.value
      let duration = next_blendshape_time - current_mapped_blendshape.time; // time between start of next viseme and current viseme

      if (current_mapped_blendshape.value !== "mouthClose") {
        if (prev_mapped_blendshape.value === "mouthClose") {
          setLipsAnimation(current_mapped_blendshape.value, startTime + current_mapped_blendshape.time, duration, 0, 1, "easeOutQuad", true)
        } else {
          if (next_blendshape_name === "mouthClose" && duration > 500) {
            duration = dummy_duration
            setLipsAnimation(current_mapped_blendshape.value, startTime + current_mapped_blendshape.time + duration, 250, 1, 0, "easeOutQuart", true);
            reverse = false
          }
          setLipsAnimation(current_mapped_blendshape.value, startTime + current_mapped_blendshape.time, duration, 0, 1, "easeOutQuad", true);
          setLipsAnimation(prev_mapped_blendshape.value, startTime + current_mapped_blendshape.time, duration, 1, 0, "easeOutQuart", true);
        }
      } else if (prev_mapped_blendshape.value !== "mouthClose") {
          if(reverse) {
            setLipsAnimation(prev_mapped_blendshape.value, startTime + current_mapped_blendshape.time, duration, 1, 0, "easeOutQuart", true);
          } else {
            reverse = true
          }
      }
    }
  }, [setLipsAnimation]);

  const killHeadMovement = useCallback((nextHeadMovementName: string = "", duration: number = 400, eye_pause: number = 0 ) => {
    if (currentHeadMovementRef.current.includes("look")) {
      const startTime = Date.now() + 25;
      const movement = headMovements[currentHeadMovementRef.current];
      const nextMovement = nextHeadMovementName ? headMovements[nextHeadMovementName] : [];

      for (const shape in movement) {
        if (!ambientMotionEnabled(shape, motionRef.current)) continue;
        if (nextMovement.hasOwnProperty(shape)) {
          continue;
        }
        setLipsAnimation(shape, startTime + (shape.includes("eye") ? 0 : eye_pause), duration, movement[shape], 0, "lerp");
      }
    } 
  }, [setLipsAnimation, headMovements]);

  const runHeadMovement = useCallback((movementName: string, duration: number, reverse: boolean = false, pause: number = 0, initial_pause: number = 50) => {
    if (!motionRef.current.headMovementEnabled && !motionRef.current.gazeEnabled) return;

    const startTime = Date.now() + initial_pause;
    const movement = headMovements[movementName];
    const eye_pause = movementName.includes('look') ? duration/2 : 0;

    killHeadMovement(movementName, duration, eye_pause)
    currentHeadMovementRef.current = movementName

    for (const shape in movement) {
      if (!ambientMotionEnabled(shape, motionRef.current)) continue;
      setLipsAnimation(shape, startTime + (shape.includes("eye") ? 0 : eye_pause), duration, 
                      readInfluence(blendShapeIndices[shape]), movement[shape], "lerp");
      if (reverse) {
        setLipsAnimation(
          shape, startTime + duration + pause, duration, movement[shape], 0, "lerp"
        ); 
      }
    }
  }, [killHeadMovement, setLipsAnimation, headMovements, blendShapeIndices, readInfluence])

  
  useEffect(() => {
    if (visemes && visemes.length > 0) {
      const mapped_visemes = getBlendShapesAzure(visemes);
      setAnimationEnds(
        Date.now() + mapped_visemes[mapped_visemes.length - 1].time + 250
      );
      // The blendshape stream already covers the mouth, at 60fps with
      // coarticulation, so only fall back to the viseme-id scheduler without it.
      if (!blendShapeFrames?.length) animateLipSync(mapped_visemes);

      const findPause = (timestamps: number[]) => {
        let filteredTimestamps = [];
        let lastTimestamp = timestamps[0];
        const interval = 3000
        for (let i = 1; i < timestamps.length; i++) {
            if (timestamps[i] - lastTimestamp >= interval || i === timestamps.length - 1) {
                filteredTimestamps.push(timestamps[i]);
                lastTimestamp = timestamps[i];
            }
        }
        if (filteredTimestamps[filteredTimestamps.length - 1] - filteredTimestamps[filteredTimestamps.length - 2] < interval) filteredTimestamps.splice(filteredTimestamps.length - 2, 1);
        return filteredTimestamps;
      }
      const pauseTime = findPause(mapped_visemes
        .filter(v => v.value === "mouthClose")
        .map(v => v.time))
      const movements = Object.keys(headMovements).filter((k) => !k.includes("look"));
      pauseTime.map(t => {
        const duration = 750
        let movement = movements[Math.floor(Math.random() * movements.length)]
        runHeadMovement(movement, duration, true, 150, t - duration)
        setTimeout(()=>{
          lastHeadMovementTimeRef.current["lastLookOutRun"] = Date.now()
        }, t - duration*2)
      })
    }
  }, [visemes, animateLipSync, runHeadMovement, headMovements, blendShapeFrames]);

  const killAll = useCallback(
    (dequeueLipSync: boolean = true) => {
      /**
       * The animation queue is emptied and all running blendshapes get reset to 0
       */
      const startTime = Date.now();
      Object.keys(animations).forEach((key) => {
        const index = key.split("#").map(Number)[0];
        const blendshapeName = Object.keys(blendShapeIndices).find(_key => blendShapeIndices[_key] === index) ?? '';
        if (dequeueLipSync || !(/\d/.test(blendshapeName)) ) {
          delete animations[key];
        } 
      });

      for (const shape in blendShapeIndices) {
        setLipsAnimation(shape, startTime, 5, readInfluence(blendShapeIndices[shape]), 0, "lerp");
      }

      currentExpressionRef.current = "";
    },
    [animations, blendShapeIndices, readInfluence, setLipsAnimation]
  );

  const killExpression = useCallback((
    nextExpresionName: string = "",
    duration: number = 400
  ) => {
    /**
     * Kills the current expression and optionally transitions to the next expression.
     * Transition: blendshapes included in next expression do not get killed -> allowed to smoothly transition to their new value via runExpression function. Prevent concurrent kill and run which leads to distortion
     *
     * @param {string} nextExpresionName - The name of the next expression to transition to (default: '').
     * @param {number} duration - The duration of the transition in milliseconds (default: 400).
     */
    if (currentExpressionRef.current !== "") {
      const startTime = Date.now() + 25;
      const expression = expressions[currentExpressionRef.current];
      const nextExpression = nextExpresionName
        ? expressions[nextExpresionName]
        : [];

      for (const shape in expression) {
        if (!ambientMotionEnabled(shape, motionRef.current)) continue;
        if (nextExpression.hasOwnProperty(shape)) {
          // do not animate blendshapes included in next expression
          continue;
        }
        setLipsAnimation(
          shape,
          startTime,
          duration,
          expression[shape],
          0,
          "lerp"
        );
      }
    }
  }, [setLipsAnimation, expressions]);

  const runExpression = useCallback((expresionName: string, duration: number, reverse: boolean = false, pause: number = 0, initial_pause: number = 50) => {
    /**
     * Runs a given expression animation on a character's face.
     * Will force kill previously running expression if any
     * For smooth transition all blendshapes start from their current state value
     * @param {string} expresionName - The name of the expression to run.
     * @param {number} duration - The duration of the expression animation in milliseconds.
     * @param {boolean} [reverse=false] - Whether to reverse the animation after it completes.
     * @param {number} [pause=0] - The pause between the end of the animation and the start of the reverse animation in milliseconds.
     * @param {number} [initial_pause=50] - The initial pause before the animation starts in milliseconds.
     */

    if (expresionName === "blink" ? !motionRef.current.blinkingEnabled : !motionRef.current.expressionsEnabled) return;

    const startTime = Date.now() + initial_pause;
    const expression = expressions[expresionName];

    if (expresionName !== "blink") {
      killExpression(expresionName); //kill previously running expression -> prevent blendshape superposition -> prevent distorted face
      currentExpressionRef.current = expresionName;
    }
    for (const shape in expression) {
      if (!ambientMotionEnabled(shape, motionRef.current)) continue;
      setLipsAnimation(
        shape, startTime, duration, readInfluence(blendShapeIndices[shape]), expression[shape], "lerp"
      );
      if (reverse) {
        //might need a fix -> better run kill expression with initial timeout
        setLipsAnimation(
          shape, startTime + duration + pause, duration, expression[shape], 0, "lerp"
        ); // auto kills the expression after some time
      }
    }
  }, [setLipsAnimation, readInfluence, blendShapeIndices, expressions, killExpression]);

  const randomHeadRef = useRef<{[key: string]: number}>({"HeadUp": 1, "HeadDown": 1, "TrunLeft": 1, "TrunRight": 1})

  const randomHeadMovement = useCallback((duration: number = 500) => {
    if (!motionRef.current.headMovementEnabled) return;
    const gap = Date.now() - lastHeadMovementTimeRef.current["lastLookOutRun"]
    const minGap = currentChatStatus === ChatStatus.IDLE ? 750 : 2300
    if (gap > minGap){
      lastHeadMovementTimeRef.current["lastRandomRun"] = Date.now()
      const upDown    = ["HeadUp", "HeadDown", ""][Math.floor(Math.random() * 3)]
      const rightLeft = ["TrunLeft", "TrunRight", ""][Math.floor(Math.random() * 3)]
      const getRandomArbitrary = (min:number, max:number) => Math.random() * (max - min) + min

      const endValueUp   = currentHeadMovementRef.current==="" ? getRandomArbitrary(0.03, 0.06) : getRandomArbitrary(0.01, 0.03)
      const endValueSide = currentHeadMovementRef.current==="" ? getRandomArbitrary(0.01, 0.025) : getRandomArbitrary(0.005, 0.015)
      if (upDown) randomMovement(upDown, duration, endValueUp*randomHeadRef.current[upDown])
      if (rightLeft) randomMovement(rightLeft, duration, endValueSide*randomHeadRef.current[rightLeft])
      randomHeadRef.current[upDown] = randomHeadRef.current[upDown]*-1
      randomHeadRef.current[rightLeft] = randomHeadRef.current[rightLeft]*-1
    }


    function randomMovement (shape: string, duration: number, delta: number) {
      const startTime = Date.now()
      const startValue = readInfluence(blendShapeIndices[shape])
      setLipsAnimation(
        shape, startTime, duration, startValue, Math.max(0, Math.min(startValue + delta, shape.includes("Trun") ? 0.055 : 0.17)), "lerp"
      );
    }
  }, [blendShapeIndices, readInfluence, setLipsAnimation, currentChatStatus])

  const randomFacialMovements = useCallback((duration: number = 350, pause: number = 25) => {
    /**
     * The function selects a random movement from a predefined list and animates it for the specified duration.
     * After the animation is completed, the blend shape values return to their initial state.
     * For smooth transition all blendshapes start from their current state value and revert to that same value
     *
     * @function randomFacialMovements
     * @param {number} [duration=350] - The duration of the animation in milliseconds.
     * @param {number} [pause=25] - The pause before the animation starts in milliseconds.
     * @returns {void}
     **/

    if (!motionRef.current.expressionsEnabled) return;
    // Cheek/brow bursts at 0.55 read as smiling mid-sentence, so leave the
    // face to the speech stream while it is driving.
    if (streamingRef.current) return;

    const startTime = Date.now() + 25;
    const randomMovements = [
      ["browInnerUp", "browOuterUpLeft", "browOuterUpRight"],
      ["cheekSquintLeft", "cheekSquintRight"],
      ["noseSneerLeft", "noseSneerRight"],
      ["cheekSquintLeft", "cheekSquintRight"],
    ];
    const randomMovement =
      randomMovements[Math.floor(Math.random() * randomMovements.length)];

    for (let i = 0; i < randomMovement.length; i++) {
      const shape = randomMovement[i];
      const startValue =
        readInfluence(blendShapeIndices[shape]);
      setLipsAnimation(shape, startTime, duration, startValue, 0.55, "lerp");
      setLipsAnimation(
        shape,
        startTime + duration,
        duration,
        0.55,
        startValue,
        "lerp"
      );
    }
  }, [setLipsAnimation, readInfluence, blendShapeIndices]);

  useEffect(() => {
    let intervals: any = []
    intervals.push(setInterval(() => {
      randomHeadMovement(950)
    }, 1100));

    intervals.push(setInterval(() => {
      const blinkTwice = Math.random() > 0.5;
      if (blinkTwice) {
        runExpression("blink", 225, true, 0);
        setTimeout(() => {
          runExpression("blink", 225, true, 0);
        }, 500);
      } else {
        runExpression("blink", 300, true, 0);
      }
    }, 6500));

    intervals.push(setInterval(() => {
      randomFacialMovements();
    }, randomDuration(3, 5)));

    return () => {
      intervals.forEach((id: any) => clearInterval(id))
    }

  }, [randomFacialMovements, runExpression, randomHeadMovement]);

  const moveEyes = useCallback((
    expression: any,
    startTime: number,
    duration: number,
    reverse: boolean,
    pause: number,
    nextExpression: any,
    prevExpression: any
  ) => {
    for (const shape in expression) {
      if (!ambientMotionEnabled(shape, motionRef.current)) continue;
      const startValue = shape in prevExpression ? prevExpression[shape] : 0;
      setLipsAnimation(
        shape,
        startTime,
        duration,
        startValue,
        expression[shape],
        "lerp"
      );
      if (reverse && !(shape in nextExpression)) {
        setLipsAnimation(
          shape,
          startTime + duration + pause,
          duration,
          expression[shape],
          0,
          "lerp"
        );
      }
    }
  }, [setLipsAnimation]);

  const eyeMovements = useCallback((
    movementSequence: any,
    duration: number,
    pause: number,
    blinkBetween: boolean = false
  ) => {
    /**
     * Function to perform a sequence of eye movements. Optionally, a blink can be added between movements.
     * @param {Array} movementSequence - An array of eye movement expressions to be performed in sequence.
     * @param {number} duration - The duration of each eye movement in milliseconds.
     * @param {number} pause - The pause between each eye movement in milliseconds.
     * @param {boolean} [blinkBetween=false] - Whether to add a blink between each eye movement.
     */
    if (!motionRef.current.gazeEnabled) return;

    const startTime = Date.now() + 100;

    for (let i = 0; i < movementSequence.length; i++) {
      const start = startTime + (2 * duration + pause) * i;
      if (blinkBetween) {
        runExpression(
          "blink",
          duration,
          true,
          0,
          (2 * duration + pause) * i - 100
        );
      }
      moveEyes(
        expressions[movementSequence[i]],
        start,
        duration,
        true,
        pause,
        movementSequence[i + 1] ? expressions[movementSequence[i + 1]] : {},
        movementSequence[i - 1] ? expressions[movementSequence[i - 1]] : {}
      );
    }
  }, [runExpression, moveEyes, expressions]);

  const abortCurrentLipsync = useCallback(() => {
    /**
     * Aborts the current lipsync animation by dequeueing all lipsync related animation identified by the index between 51 and 73
     * If the lipsync movement is already running, the movement is dequeued and new animation reverting the movement to 0 is enqueued
     */
    for (const animation in animations) {
      const [index, startTime] = animation.split("#").map(Number);
      if (51 < index && index < 73) {
        const elapsedTime = Date.now() - startTime;
        delete animations[animation];
        if (elapsedTime > 0) {
          setLipsAnimation(
            Object.keys(blendShapeIndices)[index],
            Date.now(),
            150,
            readInfluence(index),
            0,
            "lerp"
          );
        }
      }
    }
  }, [animations, setLipsAnimation, blendShapeIndices, readInfluence]);

  useEffect(() => {
    abortCurrentLipsync();
  }, [abortLipsync, abortCurrentLipsync]);


  useEffect(() => {
    let timeoutIds: any = [];
    const intervalFunction = (max = 12, isInterval = true) => {
      // run smiling and attentive animations on idle
      // start running 5 seconds into a idle mode and then with intervals of 15 seconds
      // kill the timeout and intervals on change from idle state.

      timeoutIds.forEach((timeoutId: any) => clearTimeout(timeoutId));
      timeoutIds = [];

      if (currentChatStatus === ChatStatus.IDLE) {
        const randValue = Math.random();
        const duration = randomDuration(max * 0.75, max);
        if (currentExpressionRef.current === "neutralSad"){
          runExpression("neutral", 400, false, duration);
        } else if (randValue < 0.5) {
          runExpression("attentive", 400, false, duration);
        } else {
          runExpression("smile", 400, false, duration);
        }
        if (isInterval) {
          const timeoutId1 = setTimeout(() => {
            //run neutral right after the smile/attentive ends
            runExpression("neutral", 400, false, 15000 - duration);
            runExpression("blink", 300, true, 0);

            if (Math.random() < 0.5) {
              // randomly after 3.5 seconds do a smirk
              const timeoutId2 = setTimeout(() => {
                //run neutral right after the smile/attentive ends
                Math.random() < 0.5
                  ? runExpression("smirkLeft", 300, false, 1400)
                  : runExpression("smirkRight", 300, false, 1400);
                setTimeout(() => runExpression("neutral", 400, false, 0), 1400);
              }, 3500);
              timeoutIds.push(timeoutId2);
            }
          }, duration);

          timeoutIds.push(timeoutId1);

          const timeoutId3 = setTimeout(() => {
            eyeMovements(["lookUpRight", "lookUpLeft"], 250, 1000, true);
          }, randomDuration(2000, 4000));
          timeoutIds.push(timeoutId3);
        }
      }
    };

    const lookOut = () => {
      if (currentChatStatus === ChatStatus.IDLE) {
        const keys = Object.keys(headMovements).filter((k) => k.includes("look") && k !== currentHeadMovementRef.current);
        let randomMovement = keys[Math.floor(Math.random() * keys.length)]
        if (Math.random() > 0.6){
          const delay = 750 - (Date.now() - lastHeadMovementTimeRef.current["lastRandomRun"])
          setTimeout(()=>{
            runHeadMovement(randomMovement, currentHeadMovementRef.current==="" ? 500:750, false);
            lastHeadMovementTimeRef.current["lastLookOutRun"] = Date.now()
          }, Math.max(0, delay))
        } else{
          killHeadMovement("", 500, 0)
          currentHeadMovementRef.current = ""
        }
      }
    }

    const intervalId   = setInterval(() => intervalFunction(8, true), 15000);
    const intervalHead = setInterval(() => lookOut(), randomDuration(8, 12));

    return () => {
      clearInterval(intervalId);
      clearInterval(intervalHead)
      timeoutIds.forEach((timeoutId: any) => clearTimeout(timeoutId));
    };
  }, [currentChatStatus, runExpression, eyeMovements, headMovements, killHeadMovement, runHeadMovement]);

  useEffect(() => {
    let intervalID: ReturnType<typeof setInterval> | null = null;
    if (currentChatStatus === ChatStatus.SENT) {
      const delay = Math.max(0, Math.min(1500 - (Date.now() - lastHeadMovementTimeRef.current['lastLookOutRun']), 1000))
      setTimeout(()=>{
        killHeadMovement("", 800, 0)
        currentHeadMovementRef.current = "";
      }, delay);
      runExpression("thoughtful", 400, false, 0, 0);
      eyeMovements(["lookUpRight", "lookUpLeft"], 250, 1000, true)
    } else if (currentChatStatus === ChatStatus.VALIDATING) {
      intervalID = setInterval(
        () => eyeMovements(["lookUpRight", "lookUpLeft"], 250, 1000, true),
        5000
      );

    } else if (currentChatStatus === ChatStatus.RESPONDINGNEUTRAL) {
      //kill any running expression if the bot is about to respond => prevent face distortion
      killExpression("");
      currentExpressionRef.current = "";
    } else if (currentChatStatus === ChatStatus.RESPONDINGHAPPY) {
      runExpression("happyTalk", 400, false, 0, 0);
    }else if (currentChatStatus === ChatStatus.RESPONDINGSAD) {
      runExpression("sadTalk", 400, false, 0, 0);
    }else if (currentChatStatus === ChatStatus.RESPONDINGSURPRISED) {
      runExpression("surprisedTalk", 400, false, 0, 0);
    }
    
    else if (currentChatStatus === ChatStatus.RECORDING) {
      //change expression to attentive when user is speaking/typing
      runExpression("attentive", 400, false);
    } else if (currentChatStatus === ChatStatus.IDLE && animationEnds !== 0) {
      //run pleased expression once bot stops speaking
      setTimeout(async () => {
        if (currentExpressionRef.current === "sadTalk")
          runExpression("neutral", 400, false);
        else if (currentExpressionRef.current === "neutral")
          runExpression("attentive", 400, false);
        else
          runExpression("pleased", 400, false);
      }, 2000);
    } else if (currentChatStatus === ChatStatus.NEWSESSION) {
      killAll();
    }
    return () => {
      if (intervalID) clearInterval(intervalID);
    };
  }, [currentChatStatus, runExpression, eyeMovements, killAll, killExpression, animationEnds, runHeadMovement]);


  useFrame((state, delta) => {
    fpsRef.current += 1

    const mediaNow = lipsyncTime(audioElRef?.current ?? null);

    Object.keys(animations).forEach((key) => {
      let { startValue, endValue, duration, interpolation, media } = animations[key];
      const [index, startTime] = key.split("#").map(Number);
      const elapsedTime = (media ? mediaNow : Date.now()) - startTime;
      if (startValue !== endValue && elapsedTime >= 0) {
        // startValue = morphMeshes[0].morphTargetInfluences[index] //
        const progress = Math.min(elapsedTime / duration, 1);
        const newValue = interpolationFunctions[
          interpolation as keyof typeof interpolationFunctions
        ](startValue, endValue, progress);

        writeInfluence(index, newValue);
      }
      if (startValue === endValue || elapsedTime > duration) {
        delete animations[key]; // dequeue animation if it has expired
      }
    });

    // Applied after the queue so speech wins the articulators while talking.
    const frame = speechFrames ? sampleFrame(speechFrames, mediaNow) : null;
    if (frame) {
      speechChannels.forEach(([channel, morphIndex]) => {
        writeInfluence(morphIndex, frame[channel]);
      });
      streamingRef.current = true;
    } else if (streamingRef.current) {
      streamingRef.current = false;
      // Utterance over: ease the articulators back to rest so the expression
      // system regains a clean mouth instead of a frozen final pose.
      const now = Date.now();
      speechChannels.forEach(([, morphIndex, name]) => {
        setLipsAnimation(name, now, 200, readInfluence(morphIndex), 0, "lerp");
      });
    }

    // Rigs without neck shapes turn the head bone instead, about axes fixed to
    // the model's frame so the bone's own orientation does not matter.
    if (headBone && rig.virtual.size) {
      const read = (name: string) => (name in blendShapeIndices ? readInfluence(blendShapeIndices[name]) : 0);
      const turn = headTurnRef.current;
      if (!turn.rest) turn.rest = headBone.quaternion.clone();
      const parent = headBone.parent.getWorldQuaternion(turn.parent);
      turn.delta.setFromEuler(turn.euler.set(
        (read("HeadDown") - read("HeadUp")) * neck.pitch,
        (read("TrunRight") - read("TrunLeft")) * neck.yaw,
        0,
        "YXZ"
      ));
      headBone.quaternion.copy(parent).invert().multiply(turn.delta).multiply(parent).multiply(turn.rest);
    }
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        killAll(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [killAll]);

  return (
    <primitive object={scene} position={placement} rotation={rotation} />
  );
};

export const GlbAvatar = ({ camera, ...restProps }: GlbAvatarProps) => {
  const [fps, setFps] = useState<number>(0);

  const handleSetFps = useCallback((newFps:number) => {
    setFps(newFps);
  }, []);

  function Loader() {
    return (
      <Html center>
        <style>{"@keyframes talking-head-spin { 100% { transform: rotate(360deg); } }"}</style>
        <div style={{ display: "inline-block", width: 15, height: 15, border: "3px solid rgba(100, 100, 100, 0.3)", borderLeftColor: "rgba(0, 0, 0, 0.9)", borderRadius: "50%", animation: "talking-head-spin 1s linear infinite" }}></div>
      </Html>
    );
  }

  return (
    <div>
      { fps>0 ? <p style={{position:"absolute", left:"5px", top: "5px", color: fps<15 ? "red" : (fps < 25 ? "yellow" : "blue")}}>FPS: {fps}</p> : <></> }

      <Canvas
        camera={camera}
        // Keep the drawing buffer readable so canvas.captureStream() (used by
        // the eval recorder) sees frames instead of a cleared black buffer.
        gl={{ preserveDrawingBuffer: true }}
        style={{
          alignSelf: "stretch",
          position: "absolute",
          width: "100%",
          height: "100%",
        }}
      >
        <directionalLight position={[0, 0, 0.866]} intensity={0.2} />
        <ambientLight intensity={0.1} />
        <Suspense fallback={<Loader />}>
          <Model setFps={handleSetFps} {...restProps} />
        </Suspense>
        <Environment preset="sunset" />
      </Canvas>
    </div>
  )};
