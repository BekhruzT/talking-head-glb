/**
 * Timeline position, in milliseconds, at which queued lip-sync animations
 * should be evaluated.
 *
 * Lip-sync runs off the audio element's own clock rather than wall time.
 * Decoding the base64 data URL delays audible playback by an unpredictable
 * 80-700ms (worst on the first utterance after load), so anchoring the
 * schedule to Date.now() bakes that delay in as a permanent lead for the whole
 * utterance. Reading currentTime every frame also survives a mid-playback
 * stall, which a fixed offset cannot.
 *
 * Returns Infinity when the utterance is over or there is nothing to play, so
 * animations still queued past the end of the audio complete to their end
 * value and get dequeued rather than freezing the mouth mid-viseme.
 */
export type MediaClock = Pick<HTMLAudioElement, "currentTime" | "ended"> | null;

export function lipsyncTime(audio: MediaClock): number {
  if (!audio || audio.ended) return Infinity;
  return audio.currentTime * 1000;
}
