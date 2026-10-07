# Variants & Techniques

## What a "variant" is

A **variant** (变式) is the *same captured clip* run through a *different parameterized Remotion
composition*. You shoot one raw take (a screen recording, a UI walkthrough), and then present it two
or three ways — one with an event-driven push-in camera, one with a static Ken-Burns stage plus
narration captions — and let the reviewer pick. The raw footage is never re-shot to make a variant;
only the render-time treatment changes.

This is why the review board (see `review-loop.md`) matches variants by filename
`renders/<id>--<variant>.{mp4,webm}`: `act1-add--zoom-follow.mp4` and `act1-add--narration.mp4` are
the same fragment, two treatments. The reviewer's `pick` in the feedback log records which treatment
won, and the winning technique/parameters are what the final assembly re-sources.

**Golden rule: captions, camera moves, and audio are render-time assets — never burned into the raw
capture.** The raw take is a clean, static, full-frame recording. Everything expressive is computed
on top by a comp, so it stays editable and re-parameterizable to the very end.

Two techniques ship in the toolkit. Each is documented below as a recipe: its **input contract**
(the JSON a worker produces alongside the take), its **behavior**, and its **tunable knobs**.

---

## (a) zoom-follow — event-driven virtual camera

`ZoomFollow.tsx` + `lib/camera.ts`. The take is a static full-page recording; all push-in, hold,
pan, and pull-back are synthesized in post from an event timeline. Good for UI walkthroughs where
you want the eye led to the thing that just happened without ever moving the real camera.

### Input contract — `events.json`

```json
{
  "video": "take.webm",
  "viewport": { "w": 1280, "h": 800 },
  "events": [
    { "tMs": 4200, "label": "search-result",
      "box": { "x": 420, "y": 180, "width": 360, "height": 120 } }
  ]
}
```

The `CamEvent` type (`lib/types.ts`):

```ts
type CamEvent = {
  tMs: number;             // ms from recording start
  label: string;
  box?: Box;               // viewport coords (worker grabs via locator.boundingBox())
  measuredVideoMs?: number;// worker's measured in-video time — camera prefers this over tMs
  zoom?: boolean;          // zoom whitelist: if ANY event flags zoom, only zoom:true pushes in
  [extra: string]: unknown;// custom worker annotations tolerated
};
```

- `box` is in **viewport coordinates** — a worker recording the take captures it with the
  automation framework's own `boundingBox()` right before the action, so the camera targets the
  exact on-screen element.
- **An event needs a `box` to move the camera.** Box-less events are pure time markers (reference
  points), they don't trigger a move.
- **End events never carry a box.** An `end`/`end-*` event is deliberately box-less so the shot
  auto-returns to WIDE at the finish — pushing in on the last beat "reads as meaningless" (a real
  director note). The final pull-back to wide is unconditional regardless.
- **VFR / webm drift:** variable-frame-rate webm exports drift, so a worker may add
  `measuredVideoMs` (the true in-video timestamp). `const at = (e) => e.measuredVideoMs ?? e.tMs`
  — the camera trusts the measured time when present.

### Behavior (`lib/camera.ts`, `buildCameraKeys` → `cameraAt`)

For each whitelisted, boxed event the camera builds a keyframe arc:

- **Approach** starts **0.25s before** the event (`fFocusStart = s(at(e)) - 0.25*fps`), holding the
  previous pose so the move begins from where the last shot ended.
- **Focus** reaches the target **0.5s after** the event (`fFocus = s(at(e)) + 0.5*fps`).
- **Hold** to **+1.3s** (`fHoldEnd = fFocus + 1.3*fps`) *only if* the next event is more than
  **2.2s** away — closer than that and it hands straight off (a pan) to the next target instead.
- **Pull-back to WIDE** if the gap to the next event is more than **4.5s**
  (`fWide = fHoldEnd + 0.8*fps`), so long dead stretches breathe at full frame.
- **Ends WIDE** always: a final key back to `{z:1,tx:0,ty:0}` 0.6s before the clip ends.

**Zoom target & clamp.** `poseFor()` picks the zoom so the target box fills roughly **55% of the
frame**, clamped to `[1.15, 2.6]`:

```ts
const zx = (comp.w * 0.55) / Math.max(1, box.width * baseScale);
const zy = (comp.h * 0.55) / Math.max(1, box.height * baseScale);
const z = Math.min(Math.max(Math.min(zx, zy), 1.15), 2.6);
```

**Geometric pan-clamp — never show black bars.** `pinnedPose()` computes the pan, then clamps it so
a zoomed card's edge can never enter the frame (which would reveal the black stage behind it). If
the scaled card is *smaller* than the frame on an axis, that axis simply doesn't pan (any pan would
expose an edge):

```ts
const cardW = video.w * baseScale * z, cardH = video.h * baseScale * z;
const maxTx = Math.max(0, (cardW - comp.w) / 2);
const maxTy = Math.max(0, (cardH - comp.h) / 2);
const clamp = (v, m) => Math.min(Math.max(v, -m), m);
return { z, tx: clamp((comp.w / 2 - qx) * z, maxTx), ty: clamp((comp.h / 2 - qy) * z, maxTy) };
```

This is exact geometry, not a heuristic — it was hardened after edge-hugging boxes leaked pure-black
strips into the frame.

**Easing.** All keyframes interpolate through one bezier, `Easing.bezier(0.33, 0, 0.15, 1)` — a
slow-out, gentle-in curve that reads as a smooth camera rather than a linear slide.

### Tunable knobs

Camera rhythm lives as constants inside `camera.ts`: the 0.25s approach lead, 0.5s settle, 1.3s
hold, the 2.2s / 4.5s gap thresholds, the `[1.15, 2.6]` clamp, the 55% coverage target, and the
bezier. Tune them there, or promote any of them to per-fragment entry-level parameters when a
reviewer wants a specific fragment to move differently.

---

## (b) narration-overlay — static stage + caption pill

`NarrationOverlay.tsx`. For clips where the composition is fine as-is and the point is *what's being
said*, not *where to look*. A barely-perceptible slow Ken Burns keeps the still frame alive; a glass
caption pill carries the line; a synced voice-over plays under it.

### Input contract — `captions.json`

```json
[
  { "t0Ms": 2000, "t1Ms": 5400, "text": "Add a friend with an ID — no phone number.", "audio": "01.mp3" }
]
```

The `Caption` type (`lib/types.ts`): `{ t0Ms, t1Ms, text, audio? }`. Guidance: `audio` is relative
to the fragment's narration dir and is generated by a TTS step; keep `t1 - t0 ≥ audio duration + 400ms`
so the pill doesn't vanish before the voice finishes.

### Behavior (`NarrationOverlay.tsx`)

- **Slow Ken Burns.** The whole stage eases from `z = 1 → 1.045` across the clip
  (`Easing.bezier(0.4, 0, 0.6, 1)`), with a tiny downward drift — enough to stop a static frame from
  looking dead, not enough to distract.
- **Bottom glass caption pill.** A blurred, rounded pill (`backdropFilter: blur(14px)`) fades and
  slides in over **0.35s** and back out over 0.35s at the tail
  (`interpolate(frame, [0, .35*fps, dur - .35*fps, dur], [0,1,1,0])`, eased
  `bezier(0.16, 1, 0.3, 1)`, an 18px slide).
- **Per-caption audio.** Each caption renders a `<Sequence from={s(t0Ms)}>` containing the
  `CaptionBar` and, if present, an `<Audio src={staticFile(audio)}>` — so the voice starts exactly
  at the caption's `t0`.

### Tunable knobs

The Ken-Burns end zoom (`1.045`) and drift, the pill's 0.35s fade/slide, and its glass styling
(blur radius, background alpha, radius, font) are all local constants in `NarrationOverlay.tsx` /
`CaptionBar`.

---

## The broader technique vocabulary — add your own comp

A variant is *any* parameterized comp over the same take. The two above are just the two that
shipped. Treat the following as a menu to extend from — each is "a comp that reads a small JSON
timeline and animates something on top of the static capture." Borrowed from a broader camera-rules
vocabulary:

- **coordinate-target-zoom** — push-in to an explicit `(x, y)` point instead of an element box
  (when you don't have a `boundingBox()` handy).
- **multi-phase-camera** — chain several named camera phases (establish → inspect → compare →
  release) as a scripted move, richer than the automatic approach/hold/pull cycle.
- **depth-of-field-blur** — blur everything outside the focus box to draw the eye, instead of (or
  with) zooming.
- **cursor-click-ripple** — synthesize a cursor and a click ripple at event coordinates, so a
  headless/clean capture still shows *where* the interaction landed.
- **motion-blur-streak** — add directional blur across fast pans/scrolls so quick moves feel
  intentional rather than janky.
- **asr-keyword-glow** — run ASR on the VO, and glow/underline the on-screen word as it's spoken
  (keyword-synced emphasis).
- **kinetic-type** — animated typographic overlays (words flying/assembling) for title cards and
  punch lines, driven by a text timeline.

To add one: write a new `<X>.tsx` comp that takes `{ entry }` (or `{ entry, config }`), reads its
own small JSON contract, and renders over `<SegmentedVideo entry={entry} />` inside a `<Stage>`.
Render it to `renders/<id>--<your-variant>.{mp4,webm}` and it shows up on the board as a new variant
of that fragment automatically — no server change needed.
