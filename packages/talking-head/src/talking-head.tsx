import { useEffect, useRef, useState } from "react";
import { Avatar, HeadSettings } from "./avatar";
import { ChatStatus } from "./avatar/animations";
import { MotionSettings } from "./avatar/motion-settings";
import { loadHead } from "./heads/index.ts";
import { Playable, Tts, Utterance, toPlayable } from "./speech";

export interface TalkingHeadProps {
  /** A GLB URL, or an installed head ref such as `rocketbox/medical-female-01`. */
  head: string;
  /** Where the CLI put heads and heads.json; defaults to "/heads". */
  headsDir?: string;
  settings?: HeadSettings;
  speech?: Utterance;
  tts?: Tts;
  thinking?: boolean;
  motion?: Partial<MotionSettings>;
  muted?: boolean;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (error: Error) => void;
}

const REF = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const SPEAKING: Record<Playable["emotion"], ChatStatus> = {
  neutral: ChatStatus.RESPONDINGNEUTRAL,
  happy: ChatStatus.RESPONDINGHAPPY,
  empathetic: ChatStatus.RESPONDINGSAD,
  excited: ChatStatus.RESPONDINGSURPRISED,
};

/** A talking GLB head that speaks each utterance it is given, in order. */
export function TalkingHead({ head, headsDir, settings, speech, tts, thinking, motion, muted, onSpeakingChange, onError }: TalkingHeadProps) {
  const isRef = REF.test(head);
  const [model, setModel] = useState<{ url: string; settings?: HeadSettings }>();
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<Playable[]>([]);
  const [current, setCurrent] = useState<Playable>();
  // Resolutions chain so a text utterance waiting on tts keeps its place ahead of later ones.
  const pending = useRef(Promise.resolve());
  const enqueued = useRef<Utterance>();
  const latest = useRef({ tts, onError, onSpeakingChange, muted });
  latest.current = { tts, onError, onSpeakingChange, muted };

  useEffect(() => {
    setModel(undefined);
    if (!isRef) return;
    let live = true;
    loadHead(head, headsDir).then(
      (loaded) => {
        if (live) setModel(loaded);
      },
      (error: Error) => {
        if (live) latest.current.onError?.(error);
      },
    );
    return () => {
      live = false;
    };
  }, [head, headsDir, isRef]);

  useEffect(() => {
    if (!speech || speech === enqueued.current) return;
    enqueued.current = speech;
    pending.current = pending.current
      .then(() => toPlayable(speech, latest.current.tts))
      .then((playable) => setQueue((items) => [...items, playable]))
      .catch((error: Error) => latest.current.onError?.(error));
  }, [speech]);

  useEffect(() => {
    if (current || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    const audio = new Audio(current.src);
    audio.muted = !!latest.current.muted;
    audioElRef.current = audio;
    const finish = () => setCurrent((playing) => (playing === current ? undefined : playing));
    audio.onended = finish;
    audio.onerror = () => {
      latest.current.onError?.(new Error("Utterance audio could not be played."));
      finish();
    };
    audio.play()?.catch((error: Error) => {
      latest.current.onError?.(error);
      finish();
    });
    return () => {
      audio.onended = audio.onerror = null;
      audio.pause();
      current.revoke?.();
    };
  }, [current]);

  useEffect(() => {
    if (audioElRef.current) audioElRef.current.muted = !!muted;
  }, [muted]);

  const speaking = !!current || queue.length > 0;
  const wasSpeaking = useRef(false);
  useEffect(() => {
    if (wasSpeaking.current === speaking) return;
    wasSpeaking.current = speaking;
    latest.current.onSpeakingChange?.(speaking);
  }, [speaking]);

  const src = isRef ? model?.url : head;
  if (!src) return null;
  return (
    <Avatar
      src={src}
      settings={{ ...model?.settings, ...settings }}
      status={current ? SPEAKING[current.emotion] : thinking ? ChatStatus.SENT : ChatStatus.IDLE}
      audioElRef={audioElRef}
      visemes={current?.visemes}
      blendShapeFrames={current?.blendShapeFrames}
      headMovementEnabled={motion?.headMovementEnabled ?? true}
      gazeEnabled={motion?.gazeEnabled ?? true}
      expressionsEnabled={motion?.expressionsEnabled ?? true}
      blinkingEnabled={motion?.blinkingEnabled ?? true}
    />
  );
}
