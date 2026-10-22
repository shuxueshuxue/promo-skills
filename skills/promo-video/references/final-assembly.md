# Final Assembly

## The grand-take approach — re-shoot, don't stitch

The naive way to build the finished promo is to take the individual approved fragments and glue them
end to end. **Don't.** Approved fragments were shot in isolation, at different times, in different
world states — stitching them yields a film that jumps between inconsistent accounts, mismatched
cursor positions, and discontinuous data.

Instead, once the *performances* are approved fragment by fragment on the review board, **re-shoot
them as one continuous, shared-world session**: a single pass through the whole story with one
consistent set of accounts, one continuous UI state, captured act by act at a uniform recording spec
(same scale factor, quality, fps). The fragments proved *what* each beat should do and *how* it
should be framed; the grand take is the clean, coherent capture of all of them in one world. The
final assembly then treats those act recordings as its sources — not the scratch fragment renders.

## `cutlist.ts` — the single source of truth

Everything about the finished film — segment order, source footage, cut points, camera treatment,
voice-over placement, music ducking, total length — is declared in one file, `src/final/cutlist.ts`.
`FinalCut.tsx` (the renderer) and `final-cut-qa.mjs` (the QA gate) both import this *same* file, so
geometry and timing are never duplicated between render and check.

One hard constraint on the file: it must stay **erasable TypeScript** (pure types + data + plain
functions — no `enum`, no decorators). The QA script imports it directly under
`node --experimental-strip-types`, which only strips types; anything that needs real transpilation
would break the QA gate.

### Global constants

```ts
export const FPS = 30;
export const FADE_FRAMES = 12;   // cross-dissolve length
export const RATE = 1.25;        // whole-film speed-up (see semantics below)
export const msf = (ms) => Math.round((ms / 1000) * FPS);  // ms → frames
```

### The two segment kinds

The film is a flat list `CUTLIST: SegSpec[]`, each entry either a synthetic composition or a video
source:

```ts
export type VoCue = { vo: VoId; atMs: number };          // atMs = start on the SEGMENT's output timeline
export type TransitionKind = "fade" | "cut";

export type SynthSegSpec = {
  kind: "synth";
  id: string;
  comp: "c1-pain" | "c2-local-idea" | "cta-card";        // an author-made comp registered in FinalCut
  durationFrames: number;                                // tight-trimmed length (comp-local frames)
  trimStartFrames?: number;                              // skip N frames of the comp's head
  duckFrames?: [number, number][];                       // comp-internal narration windows (for BGM duck)
  embeddedVos?: { vo: VoId; atFrames: number }[];        // narration baked into the comp (QA registration)
  vos?: VoCue[];                                         // externally-laid VO (audio + caption pill)
  transitionAfter?: TransitionKind;                      // default fade; ignored on last segment
};

export type FrameSpec = { cx: number; cy: number; z: number }; // constant framing (skip event camera)

export type VideoSegSpec = {
  kind: "video";
  id: string;
  src: string;                                           // renderer/public relative path
  keepMs: { fromMs: number; toMs: number }[];            // segments to KEEP on source timeline (asc, non-overlapping)
  manifestId?: string;                                   // placeholder: borrow viewport+events from a fragment
  eventsFile?: string;                                   // grand-take: public-relative events.json {viewport, events}
  frame?: FrameSpec;                                     // constant framing (whole segment pinned, no event camera)
  vos?: VoCue[];
  transitionAfter?: TransitionKind;
};

export type SegSpec = SynthSegSpec | VideoSegSpec;
```

- **synth** segments are fully authored compositions (a cold-open pain montage, a CTA card) —
  rendered directly, optionally with narration baked in (`embeddedVos`) or laid over (`vos`).
- **video** segments are grand-take act recordings. `keepMs` selects which source spans survive
  (everything else is cut). The camera comes from either `manifestId` (borrow a fragment's events
  during the placeholder phase) or `eventsFile` (the delivered act's own events.json) — **one is
  required, missing both throws**. A `frame` field pins the whole segment to a constant pose instead
  of running the event camera.

### The VO table and BGM config

Voice-over lines are a table keyed by id, each with its measured audio duration (probed, not
guessed) and source path:

```ts
export type VoId = "01" | "02" | "02b" | "03" | ... | "12";
export const VO_TABLE: Record<VoId, { text: string; durMs: number; src: string }> = {
  "01": { text: "…", durMs: 8382, src: "vo/01.mp3" },
  // …
};
```

Background music is one looped track with an explicit duck contract:

```ts
export const BGM = {
  src: "music/its-love--….mp3",
  skipSeconds: 15,     // start playback 15s into the track
  baseVolume: 0.13,    // ≈ -18dB bed
  duckRatio: 0.35,     // duck to 35% of the bed under each VO window (≈ another -9dB)
  duckRampFrames: 9,   // ramp in/out of the duck over 9 frames
};
```

### `layoutCutlist()` — compile-time layout

`layoutCutlist()` walks `CUTLIST` once and computes the entire timeline **at compile time**, so both
the renderer and QA read identical numbers:

```ts
export type Layout = {
  starts: number[];               // absolute start frame of each segment (CUTLIST order)
  totalFrames: number;            // whole-film length
  cues: LayoutCue[];              // every VO's absolute frame + duration + text (incl. embedded)
  duckWindows: [number, number][];// absolute frame windows where BGM ducks
  ctaStartFrame: number;          // start of the final synth (CTA) segment
};
```

- **starts / totalFrames** accumulate `segFrames(seg)`, subtracting `FADE_FRAMES` at each `fade`
  boundary (a dissolve overlaps the two segments) but not at a `cut`.
- **cues** collects both externally-laid `vos` (`startFrame = segStart + msf(atMs)`) and synth
  `embeddedVos` (offset by `trimStartFrames`), each carrying `VO_TABLE[vo].durMs` as its length,
  then sorts by absolute frame — this is the VO time-table QA checks against.
- **duckWindows** = one window per VO cue plus each synth's `duckFrames`, all in absolute frames.

`segFrames` for a video segment is where `RATE` enters the length math:

```ts
export const segFrames = (seg) =>
  seg.kind === "synth"
    ? seg.durationFrames
    : seg.keepMs.reduce((a, k) => a + Math.max(1, msf((k.toMs - k.fromMs) / RATE)), 0);
```

## `FinalCut.tsx` — rendering the cutlist

`FinalCut` maps the resolved cutlist into a `<TransitionSeries>`, inserting a `fade()` transition
(`linearTiming({ durationInFrames: FADE_FRAMES })`) after each segment whose `transitionAfter` is
`fade`, and nothing (a hard cut) after a `cut`.

Per-segment content (`SegContent`):

- **synth** → render the registered comp (`SYNTH_COMPS[seg.comp]`), optionally offset by
  `trimStartFrames` via a negative-`from` Sequence, with its `vos` laid over.
- **video with `frame`** → `PinnedFrame`: a constant pose from `pinnedPose(...)` (the **same**
  pan-clamped geometry the event camera uses — see `variants-techniques.md`), used when a source's
  composition is lopsided (e.g. content only fills the left half) and you want to push the empty
  region out of frame for the whole segment.
- **video without `frame`** → `ZoomFollow`: the full event-driven camera, reusing the entire
  zoom-follow chain.

**VoLayer** renders each `VoCue` as its own Sequence — a `CaptionBar` (the glass pill) plus an
`<Audio>` — starting at `msf(atMs)`, i.e. externally-laid VO is a caption+audio pair placed on the
segment's local timeline.

**BGM** is a single looped `<Audio>` (`trimBefore = skipSeconds*FPS`, `loop`) whose `volume` is a
per-frame callback `bgmVolume(f)`:

```ts
const bgmVolume = (f) => {
  let duck = 1;
  for (const [a, b] of DUCK_WINDOWS)      // duck to duckRatio inside each VO window (ramped)
    if (f > a - r && f < b + r)
      duck = Math.min(duck, interpolate(f, [a - r, a, b, b + r], [1, duckRatio, duckRatio, 1], clamp));
  const fadeIn  = interpolate(f, [0, 20], [0.5, 1], clamp);
  const fadeOut = interpolate(f, [CTA_START, TOTAL - 6], [1, 0], clamp);
  return BGM.baseVolume * duck * fadeIn * fadeOut;
};
```

So the bed sits at `baseVolume`, ducks to `baseVolume * duckRatio` under every VO window, fades in at
the top, and fades out from `ctaStartFrame` to the end. The **CTA** is simply the final synth
segment (`cta-card`), and the BGM fade-out is anchored to its start.

### `calculateMetadata` — resolve + validate (fail loud)

Before render, `finalCutCalcMeta` resolves every video segment and **validates hard**:

- events/viewport come from `manifestId` *or* `eventsFile` — neither present → throw with the seg id.
- `keepMs` must be non-empty, each `fromMs < toMs`, ascending and non-overlapping, and within the
  probed source duration (`toMs > rawMs + 80` throws). A miswritten cut point stops the render, it
  is not silently clamped.
- events are remapped onto the segment's output timeline (`mapSrcToOut(...) / RATE`), dropping any
  event that falls in a cut-away span so it can't snap to a cut seam.

## `RATE = 1.25` semantics

The whole film plays at **1.25×**, but only the *picture* speeds up. Precisely:

- **Video plays 1.25×.** The `SegmentedVideo` advances source frames at `playbackRate = RATE`.
- **`keepMs` and event anchors stay in source time.** You draw cuts and read event timestamps in the
  original recording's milliseconds — you never pre-divide by RATE by hand.
- **Output frames = source / RATE.** `segFrames` divides the kept span by RATE; event anchors are
  remapped as `mapSrcToOut(ms) / RATE`. The system does the division.
- **VO audio is unchanged** — not sped up, not pitch-shifted. Voice-over stays at natural pace; only
  the visuals compress under it. (Synth segments don't take RATE either; they're tightened by
  precise re-trimming of `durationFrames` instead.)

## Re-sourcing recipe (SWAP-GUIDE)

When the grand-take acts are delivered, swapping the placeholder fragments for real footage is a
**cutlist-only edit** — you touch no component code:

1. **Drop the assets** into `renderer/public/acts/`: `actN.mp4` plus `actN.events.json`
   (`{ video, viewport, events }`, events carrying `zoom: true` on the beats the camera should push
   in on — the whitelist).
2. **Edit each video segment** in `cutlist.ts`:
   - `src` → `"acts/actN.mp4"`; delete `manifestId`, replace with `eventsFile: "acts/actN.events.json"`.
   - **Redraw `keepMs`** against the new events' timestamps, in **source milliseconds** (ascending,
     non-overlapping; out-of-range throws).
   - **Align `vos[].atMs`** on the segment output timeline so each line lands on its subject —
     *the frame at a VO's start must be that line's subject* (VO neither arrives late nor points at
     the wrong thing). Audio durations are already in `VO_TABLE`.
3. **Render + QA:**
   ```bash
   cd renderer
   npx remotion render final-cut ../renders/final-cut.mp4
   node scripts/final-cut-qa.mjs
   ```

Sanity-check total length stays in band after editing (target ≈ 96s under 1.25×, practical floor
~100s because VO/synth don't speed up).

## The QA gate — `final-cut-qa.mjs`

The QA script imports the **same `cutlist.ts`** (via `--experimental-strip-types`, auto-re-execing
itself with the flag) so there is **no duplicated geometry** — it checks the exact layout the film
was rendered from. Three checks:

1. **Duration consistency.** ffprobe the rendered file and compare to `layout.totalFrames / FPS`.
   A mismatch > **0.5s** is fatal (`exit 1`) — the film on disk isn't the current cutlist, re-render
   first. Separately, a total outside the **90–110s** band is a warning (drifted off the 1.25×
   target).

2. **Blank-screen scan (per video segment, card interior only).** For each video segment it computes
   the card's on-screen geometry from that segment's viewport (same `baseScale` as the stage) and
   **insets 8%** so the crop is always strictly inside the card (zoom only enlarges the card, never
   crops out of it). It also pads 0.45s off each segment's ends to skip the dissolve mix. Then it
   runs ffmpeg `blackdetect` twice:
   - **black:** `blackdetect=d=0.4:pix_th=0.10`
   - **white (negated):** `negate,blackdetect=d=0.4:pix_th=0.07:pic_th=0.99`

   The white thresholds are calibrated so a genuine sparse-but-populated page passes while a pure
   loading/empty page is caught: `pix_th=0.07` excludes light-grey UI surfaces, `pic_th=0.99` means
   only near-total-white frames (≈0.995+) hit. **Any hit ≥ 0.4s fails** — a cut point landed on an
   empty frame; fix `keepMs`, re-render, re-run. Zero hits required to pass. (Interior-only because a
   cut point can look fine at the events' timestamp yet land on a blank page — you scan the real
   pixels, not the event log.)

3. **VO-picture alignment dumps.** For every cue in `layout.cues` (including synth `embeddedVos`) it
   dumps two frames — at cue **start** (+0.1s, past the caption fade-in) and cue **mid** — to
   `renders/final-cut-qa/vo-<id>-{start,mid}.png`, and prints the full VO time-table. These are for
   **manual** subject-alignment review: the frame at each VO's start must show that line's subject.

The gate passes only when duration is consistent, the blank scan is **zero hits**, and every VO
start frame is manually confirmed against its subject. Note: if the acts switch to a dark theme, the
"white" check naturally goes quiet and the "black" `pix_th` may need a small nudge — the thresholds
live in the QA script, the standard ("a full frame of no content is a reject") does not change.
