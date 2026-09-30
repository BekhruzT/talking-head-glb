# Lip-sync eval

Fixed utterances rendered twice on the same avatar: `reference/` is a real
human's blendshape capture replayed with the human's own audio, `generation/` is
the same words through the live pipeline.

Two corpora, picked with `?corpus=`:

| corpus | source | cases | ids | idle layer in captures |
|---|---|---|---|---|
| `inputs2` (default) | 3D-ETF, screened HDTF speakers | 10 | `etf01`… | off |
| `inputs` | BEAT, speaker 9 "miranda" | 20 | `case01`… | **on** |

Ids differ between them, so both corpora's videos share `reference/` and
`generation/` without colliding.

`inputs` is superseded on both counts: BEAT's face track is not a lip-sync
ground truth (below), and its captures predate the eval flags, so the avatar
still blinks, shifts its gaze and moves its head in them. Measured as mean
frame-to-frame difference in a brow/eye crop, the BEAT captures read 3.5–5.3
— about the same as their own mouths — against 0.05 for the 3D-ETF captures,
where the mouth reads 1.8–3.9. At the hair edge, where a head turn shows, it is
0.5–0.8 against 0.03. Only `inputs2` is lip-sync-only.

### Watch the comparison

Open `compare.html` — double-clicking the file works.

### Score it

```
cd backend; npm run dev               # :4000 /tts, needs root .env SPEECH_KEY/REGION
node eval/metric-probe.mjs              # -> eval/scores.js, picked up by compare.html
```

Scores read the **source blendshape streams**, not the videos. The videos are
for watching. A mouth-box luminance curve tracks its own audio at only r 0.44,
which caps any comparison between the columns below anything useful; the streams
those videos are rendered from score 0.58.

**Timing** puts both streams on a common clock using **word boundaries** — exact
from Azure's synthesiser (`wordBoundary`), recognised for the human recording
(`requestWordLevelTimestamps`) — then correlates the four articulators that
survive the trip between two different solvers: `mouthPucker`,
`mouthShrugUpper`, `mouthLowerDownRight`, `mouthClose`. Words are matched by
longest common subsequence, not by position, because the two sides genuinely
disagree in places ("3000" is one token to the synthesiser and "three thousand"
to the recogniser) and one such spot would shift every later anchor.

Anchors rather than a fitted warp is the whole point. Warping one audio envelope
onto the other **forces** the two to resemble each other, so a wrong sentence
scores 0.12 — partial credit for nothing. On ground-truth anchors it scores 0.03.

**Scale**: 10 = r 0.936, what two Azure renderings of the same words in
different styles score (`--ceiling`). **Lag** is the shift still left after the
words line up, so it is the mouth moving early or late *within* the words;
positive is late. **Expressiveness** is excursion ratio on the same channels,
kept out of timing so the two failures never hide each other.

The metric was chosen by measurement, not taste, and the modes are still there:

```
node eval/metric-probe.mjs --scan       # which channels carry across solvers
node eval/metric-probe.mjs --combos     # which set of them separates best
node eval/metric-probe.mjs --filters    # smoothing/bandpass variants
node eval/metric-probe.mjs --ceiling    # what a correct answer can score
node eval/metric-probe.mjs --selfcheck  # pins the lag sign to a known shift
```

Every run prints the control: the same metric against deliberately wrong
answers. It is the only reason to believe the number.

| | timing r |
|---|---|
| same words, different style (ceiling) | 0.936 |
| **reference vs pipeline** | **0.366** |
| wrong sentence | 0.028 |
| noise | 0.030 |
| reversed | −0.066 |

Worst real pair 0.207 beats best wrong answer 0.134, so the ranking is clean.
`jawOpen` alone does not manage this (worst real 0.207 against best wrong
**0.184**) — it is the 7th best channel, well behind `mouthPucker` at 0.44.

### Known: the BEAT reference is not a lip-sync ground truth

Measured off `fixture.json` directly — no video, no rendering — BEAT's own
`jawOpen` track correlates **−0.04** with its own audio envelope at zero lag,
rising to only ~0.25 at a per-clip lag that is scattered randomly across
±800 ms. Neither a constant offset nor a time-scale correction rescues it
(capture/wav ratio is 0.9997, best scale ~1.000). It separates speech from
silence by 0.69 sd, and one of eight clips is inverted.

Azure's stream through the identical test scores **0.49** at zero lag with lags
clustered near zero, and separates speech from silence by 2.17 sd — so the
measurement is sound and BEAT is the weak side. BEAT is a body-gesture corpus;
its ARKit face channel is a secondary signal.

Consequence: `inputs2` exists because of this finding, and the scores above are
only reported for it.

### The 3D-ETF corpus (`inputs2`)

Same idea, a better reference. 3D-ETF is ARKit blendshapes tracked off
talking-head video, shipped paired with the audio; its HDTF half is long-form
speech from ~100 US politicians and radio hosts. Quality varies per clip because
it is a tracker over YouTube, so clips are screened rather than trusted:
8 of 179 pass, and those beat both benchmarks — jaw-vs-audio **r 0.58** with the
best lag steady to **±20 ms**, against BEAT's 0.25 over a lag scattered across
±800 ms. Same speaker, different clips, gives the same offset (both Obama clips
land at −200 ms), which is why the offset is treated as a source A/V delay and
subtracted at cut time rather than counted as error.

Two caveats: speech/silence separation is *not* a valid screen here (HDTF is
continuous oratory where sub-second "silences" are stop consonants the jaw does
not close for), and 3D-ETF ships no transcripts, so each cut is sent to Azure
STT to get the text the generation column speaks.

```
powershell eval/inputs2/extract-3detf.ps1 -All   # 3D-ETF.zip -> inputs2/raw/ (838MB, gitignored)
node eval/inputs2/check-sync.mjs                 # score all 179 -> screen.json
node eval/inputs2/build-etf-fixture.mjs          # -> inputs2/etfNN/fixture.json + cases.js
```

The zip is not redistributable and not in the repo; request it from the EmoTalk
authors. `ARTICULATION_GAIN` is the knob, and unlike BEAT it starts at 1.0 —
3D-ETF's raw jaw range already lands where BEAT's did after boosting.

### Two things to fix, both measured

**The mouth is late, by a constant.** All 10 cases lag in the same direction,
mean **+72 ms**, and that is *after* the words are aligned — so it is not the
audio being offset, it is the articulation sitting late inside each word. Humans
anticipate: the lips move before the sound. Removing the offset lifts timing
0.366 → **0.425**, so roughly a sixth of the remaining gap is one number in one
place. Playing the blendshape stream ~70 ms ahead of its audio is the experiment.

**The mouth moves too far.** Expressiveness is **1.65–2.37x** the human,
mean 1.9x, on every case. Both streams drive the same rig, so a coefficient
means the same displacement in both columns and the ratio is real motion rather
than a units difference. `ARTICULATION_GAIN` on the *Azure* side is the knob.

The idle layer is not implicated in either, and now cannot be: the metric reads
the speech streams before rendering, so blinks, gaze and the neck are not in the
measurement at all. Back when scoring did come off the pixels, turning them off
moved nothing either. Keep them off while recording anyway — the videos are what
you judge by eye.

### Making the voice come from the mouth — tried, dropped

Azure returns anechoic, close-mic'd speech, which the ear reads as voiceover
rather than as a person in front of you. A `voice-space.ts` put it in a small
synthesised room with an HRTF panner at mouth height. It was reverted. Do not
rebuild it without reading why, because it fails for a reason tuning cannot fix.

- **Reverb is a distance cue.** The direct-to-reflected ratio is how the ear
  judges how far away a source is, so every audible setting pushes her *further
  away* — the opposite of the ask. Measured on captures, tail level relative to
  speech: dry −19.8 dB, 8% wet −19.5 dB, 18% wet −14.3 dB. 18% is the only
  audible one and it reads as an echo from the back of the room; 8% is 0.3 dB
  from dry with the same 40 ms decay, i.e. no effect. There is no value in
  between that means "closer". See `_ab/tail.mjs`.
- **Panning cannot help a centred source.** Her mouth is dead centre and level
  with the camera, so there is no interaural difference to encode. The HRTF
  panner measured 6 ms of latency and bought nothing.
- The achievable version of the ask is a *proximity* voicing, not a room: low-mid
  lift for chest, presence lift near 3 kHz, no tail. Untried.
- Bandwidth is not the difference between the columns. The 3D-ETF source wav is
  16 kHz mono and the backend requests `Audio16Khz32KBitRateMonoMp3` — both
  telephone-band.
- If a convolver ever comes back: `ConvolverNode.normalize` must be **off**. Its
  calibration assumes a measured response dominated by a sharp direct spike;
  against dense synthetic noise it scales the room down by ~83 dB, leaving it
  wired up, visible in the graph and completely inaudible.

### Re-record either column

```
node eval/inputs/upload-server.mjs      # :4100 fixtures + capture uploads
cd backend && npm run dev               # :4000 real /tts, needs root .env SPEECH_KEY/REGION
cd frontend && npm start                # :3000 the avatar being recorded
node eval/inputs/convert-captures.mjs reference    # trim to speech onset, encode H.264
```

Load the page as `:3000/?noExpressions=1&noHeadMovement=1` so the mouth is the
only thing moving. The idle layer (emotions, blinks, gaze darts, brow/cheek
bursts) and the neck run on their own timers with no relation to speech, so
otherwise every capture catches whichever of them happened to fire — motion the
mouth-box signal cannot tell from articulation, in both columns. Over 14s of
idle, the default page moves in 48 of 55 sampled intervals; with both flags, 0.
Either flag works alone, and both default to on so normal use is unchanged.

The recording runs in the browser — it needs a real WebGL canvas and the page's
audio clock, so there is nothing to drive from node. Load the app as
`localhost:3000/?noExpressions=1&noHeadMovement=1` so blinks, gaze darts and the
neck stay still and the mouth is the only thing moving.
`inputs/record-harness.js` is the snippet: pick the "Ava" avatar, wait for the
canvas, then

```js
installHarness(); micOn();
await recordAll(["etf01","etf02"], "reference");   // or "generation"
```

It stubs `SpeechRecognition`, answers `/tts` from the fixture (reference) or
lets it reach the backend (generation), and starts `MediaRecorder` inside the
patched `Audio` constructor so the tracks start together. The backend is only
needed for the generation column.

For generation it also rewrites the `/tts` body from the app's
`{chat, messages}` to `{text, emotion}`. The chat branch would speak an LLM
*reply* to the transcript, so the columns would be saying different sentences;
the non-chat branch speaks the words given and skips OpenAI (whose key is
currently dead — a 401 there takes the whole backend down, since the handler
does not catch it).

Three ways a capture looks fine and is not:

- **A blank opening reads as broken lip-sync.** The GLB loads asynchronously and
  an empty r3f canvas renders black, so a recorder armed before the avatar
  appears plays its first seconds of audio over nothing and the mouth turns up
  mid-sentence. Measured on a fresh page load the avatar took **4.7 s** to
  render, and the first case of a batch was black for 3.5 s while the other nine
  were clean — which is what makes it easy to miss. The harness now waits on
  `__canvasReady()` (canvas pixels, not a load event) and refuses to record if
  the avatar never renders. `_ab/blank-start.mjs` audits finished files.

- **Keep the browser window frontmost.** Chrome throttles
  `requestAnimationFrame` in a backgrounded window and the avatar renders on
  rAF, so a capture taken behind another window is a ~1fps slideshow that still
  thumbnails correctly. Recording many cases back to back does the same thing if
  the harness leaks its capture streams. The converter rejects under 10fps.
- **Silent video.** `audio.captureStream()` at construction time returns no
  audio track yet, and `MediaRecorder` will happily record video alone. The
  audio goes through a Web Audio `MediaStreamDestination` instead, which has its
  track immediately. One shared `AudioContext` for the page, since contexts are
  limited and one per utterance runs the tab out partway through a corpus. Record
  with the voice unmuted: muting mutes the element that feeds the graph. The
  converter rejects any capture with no audio stream.

And one that is not the capture's fault: if a case times out, its `/tts` is
still in flight, and the app queues the media when it lands — so a *later* case
records the abandoned utterance instead of its own, at a plausible duration and
with no error. The harness refuses to record after a timeout; reload the page
and restart the batch.

### Rebuild the BEAT corpus (`inputs`)

```
node eval/inputs/download-corpus.mjs    # fetch 20 BEAT clips into inputs/caseNN/
node eval/inputs/build-beat-fixture.mjs # -> caseNN/fixture.json + inputs/cases.js
```

Needs `ffmpeg` and `inputs/deep-filter.exe`; `ARTICULATION_GAIN` is the knob.
