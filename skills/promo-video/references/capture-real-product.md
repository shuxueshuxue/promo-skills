# Capturing the real product at HD

How to record footage of a real web UI that survives being blown up on screen — the
zoom-in "hero" shots a promo video lives on. This is a distilled bench report: one method
won, several plausible ones were tested to death and lost. Keep the loser list; it is the
whole point of not re-litigating this.

---

## The acceptance gate: "clean at 2.6× zoom"

The single pass/fail test for any capture path: **take a frame, scale it to 2.6×, and look at
the smallest text.** If the strokes have blurry/muddy edges at 2.6×, the path fails — full
stop. (2.6× because that is the tightest push-in the edit actually uses; small CJK glyphs are
the worst case, but any small UI text works.)

Two facts fall out of this gate that shape everything below:

- **At 1× everything looks fine.** recordVideo, trace, screencast, shot-loop — side by side at
  1× they are nearly indistinguishable. The gap only opens *after* you push in. So you cannot
  judge a capture path by eyeballing it at native size; you must judge it zoomed.
- **Clean at 2.6× requires real 2× pixels.** A 1600×1000 frame upscaled 2.6× is 4160px of
  interpolated mush. A 3200×2000 frame (true 2×) upscaled 2.6× still has real detail to show.
  So the whole game is: *get genuine 2× physical pixels out of the browser.*

---

## The winner: CDP `Page.captureScreenshot` pull-loop at real 2×

Actively pull one screenshot per tick over the Chrome DevTools Protocol, throttled to a target
FPS, each frame written to disk with an epoch timestamp. On a real (non-synthetic) app page
this holds a steady **19–20 fps at 3200×2000, jpeg q100** (~84 KB/frame), every frame a complete
`fromSurface` composite — no torn/damaged frames. At 2.6× it is visually indistinguishable from
a lossless PNG reference. This is the only path that passed the gate on real pages.

The recorder is `toolkit/capture/recorder-shotloop.ts` (`ShotLoopRecorder`). It writes the same
on-disk shape any downstream assembler expects: `frames/fNNNNNN.jpg` +
`frames.json { endTsMs, frames: [{ file, tsMs }] }`, `tsMs` = epoch milliseconds.

### The one non-negotiable launch flag

Real 2× comes **only** from launching the browser process with
`--force-device-scale-factor=2`. The per-context `deviceScaleFactor: 2` you pass to
`newContext` is, under headless, **a lie** for capture purposes: it changes only what
`window.devicePixelRatio` *reports*. The physical surface that screencast/screenshot reads back
stays at the window's physical size — the frames come out 1600×1000 regardless. This is the
single most expensive mistake to make; it produces footage that looks 2× (DPR says 2) but is
physically 1×, and you don't find out until the 2.6× gate.

The rule, stated flat: **headless capture resolution = window physical size = `--window-size` ×
launch-level device-scale-factor.** Context emulation does not touch the physical surface. So
you need *both* — the launch flag to make the surface 2×, and the context DSR to keep layout /
`boundingBox()` / event coordinates in the 1600-wide CSS space you author against.

Exact launch/context code (both lines matter):

```ts
import { chromium } from '@playwright/test'
import { ShotLoopRecorder } from './recorder-shotloop'

// 1) launch MUST carry the flag — it is the ONLY source of real 2× pixels
const browser = await chromium.launch({
  args: ['--no-sandbox', '--force-device-scale-factor=2'],
})
// 2) context DSR:2 keeps layout + boundingBox() + events in 1600-CSS coords
const ctx = await browser.newContext({
  baseURL,
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()

const rec = new ShotLoopRecorder(page, { fps: 20, quality: 100 })
await rec.start(actDir)   // first frame is resolution-checked; fails loud if not 3200 wide
// …perform the beats, recording events as epoch ms into events-epoch.json…
const stats = await rec.stop()  // { frameCount, avgFps, maxGapMs, skippedTicks }
```

The two capture calls in `ShotLoopRecorder`:

```ts
const { data } = await this.cdp!.send('Page.captureScreenshot', {
  format: 'jpeg',
  quality: this.opts.quality ?? 100,
  fromSurface: true,
})
// timestamp = midpoint of request/return (compositing happens between; ~33ms RTT, ±17ms error)
return { buf: Buffer.from(data, 'base64'), tsMs: (t + Date.now()) / 2 }
```

### The resolution self-check that fails loud

Because "forgot the launch flag" is silent and catastrophic, `start()` captures one frame first
and asserts its physical width before recording anything:

```ts
const vp = this.page.viewportSize()
const expectW = this.opts.expectWidth ?? (vp ? vp.width * 2 : 0)
const first = await this.captureOne()
if (expectW > 0) {
  const dims = jpegDims(first.buf)          // parse SOF0/SOF2 marker for real w/h
  if (!dims || dims.w !== expectW) {
    throw new Error(
      `ShotLoopRecorder: frame width ${dims?.w ?? '?'} ≠ expected ${expectW}. ` +
      `Browser must launch with --force-device-scale-factor=2; context with deviceScaleFactor:2.`,
    )
  }
}
```

`jpegDims` reads the JPEG's own SOF marker rather than trusting any reported size — it measures
what is *actually there*. If you get 1600 when you asked for 3200, you stop immediately instead
of shooting an entire session at 1×.

Other fail-loud edges in the same recorder: a single mid-loop capture failure sets `loopError`
and halts (better a loud stop than a torn-timeline take, re-thrown from `stop()`); zero frames
throws; the tick skips (`skippedTicks`) if the previous shot is still in flight, so the timeline
stays honest instead of piling up. Watch `skippedTicks` — more than single digits means the
machine is overloaded (something heavy running in parallel); reshoot that beat.

### Knobs

| knob | effect |
|---|---|
| `format: 'jpeg', quality: 100` | default. ~84 KB/frame at 3200×2000. Indistinguishable from lossless PNG at 2.6×. |
| `quality: 92` | ~52 KB/frame. Acceptable when disk is tight. (q95 ≈ 82 KB.) |
| PNG + `optimizeForSpeed: true` | lossless master; ~24 fps on synthetic pages, ~15 fps otherwise. Use only when you need a lossless intermediate. |
| `format: 'webp'` | **don't** — webp100 throughput is ~7 fps (4× slower than jpeg). |
| dual streams (two contexts, two recorders) | works for A/B split-screen shots; each lands ~17 fps (readback serializes in the browser process, so targeting 20 or 30 both converge to ~17). Well above a >10 fps floor. Events align naturally via epoch timestamps. |

Disk budget: ~8 MB/s per stream at q100. A 4–6 minute raw shoot is ~2–3 GB. Assemble, then
delete `frames/`.

---

## Rejected alternatives (do not re-litigate)

Every one of these was tried on the *real* app page, not a synthetic demo. Each died for a
concrete reason. The synthetic-page caveat matters: several of these look great on a hand-built
animation page and collapse on a real product page — so "it worked in my quick test" is not
evidence.

| path | real resolution | real-page framerate | why it died |
|---|---|---|---|
| **`recordVideo` (Playwright built-in)** | 1600×1000, VP8 ~0.6 Mbps | ~25 fps VFR | **Too blurry at 2.6×** — strokes have muddy edges. The baseline everyone reaches for first; fails the gate. Also VFR drift makes timestamps unreliable. |
| **CDP `Page.startScreencast` @2×** | 3200×2000 *with the flag* | **0.2–0.3 fps — starves** | screencast is **damage-driven**: it only emits a frame when the compositor reports damage. Synthetic animation pages fire 68–92 fps; real product pages (hover + smooth scroll + settle) emit **~3 frames in 12s across every config tested**, including the config that hit 68 fps on the synthetic page. This is content-level, not a tuning problem — ack cadence, quality, `everyNthFrame` all irrelevant. `captureScreenshot` wins precisely because it is an *active pull*: every tick forces a composite, so every frame comes out. |
| **Playwright trace viewer** | **800×500 hard cap** | ~14 fps but maxGap 3.5s | Trace snapshots are capped at 800×500 and heavily re-compressed; that is **4× lower than even the recordVideo baseline** and unreadable at 2.6×. Snapshots are taken at action boundaries, so realtime UI updates and smooth scrolls fall into multi-second holes with no frame. No video-conversion tool fixes source data that was never captured. |
| **OS-level screen capture** (ffmpeg avfoundation / `screencapture -v`) | screen physical (e.g. 3024×1964, *below* 3200×2000) | ~30 fps in theory | **Blocked at the system layer over SSH**: macOS ScreenCaptureKit refuses video from a non-console/SSH session (`screencapture -v` → "operation could not be completed"; old avfoundation `AVCaptureScreenInput` hangs). Fixing it needs a human at the physical console to grant a GUI session. Even if unblocked: screen res is below 2×, you'd have to crop the menu bar, and **foreground-window contention is real** — another app stealing the front can pollute the frame. |
| **`HeadlessExperimental.beginFrame`** (deterministic frame-stepping) | — | — | **Crashes the browser process.** With `--enable-begin-frame-control --run-all-compositor-stages-before-draw`, the first `beginFrame` closes the target (browser crash), reproduced 3/3 across strict-serial / no-flag / persistent variants on the tested headless build. Dead unless you swap browser builds. |
| **In-page `MediaRecorder`** (tab capture VP9) | — | — | **No capture source headless.** `getDisplayMedia` → `NotReadableError: Could not start video source` regardless of `--auto-select-*-capture-source` flags or `preferCurrentTab`. Not a secure-context issue (fails on `http://127.0.0.1` too) — there is simply no source to capture. |
| **Electron native** (`webContents.capturePage` / `desktopCapturer`) | — | — | Not shot. `capturePage` is the same compositor readback as CDP `captureScreenshot` (no quality gain expected); `desktopCapturer` needs a headful window (inherits the foreground-contention risk). If you ever need a "real Electron shell" shot, film the *same web UI* inside the shell with this recorder rather than standing up a GUI Electron. |

A note on bitrate: after assembly, a mostly-static shot can report a very low bitrate (0.2 Mbps
under CRF-constant-quality) — that is **content being still, not blur**. Judge sharpness by
sampling frames, not by the bitrate number. Any `<8 Mbps` warning from the assembler should be
read with that in mind.

---

## The capture contract (per shot)

A shot is only usable if it was *performed like a human* and *annotated as it happened*. Two
halves:

### 1. Perform like a human

- **Hover / pause ≥300 ms before every click.** No teleporting cursors.
- **Type at 60–90 ms per character.** Never `fill()` a field instantly.
- **Let animations finish** before the next step — don't step on an in-flight transition.
- **Hold 2s at head and 2s at tail** so the edit has clean handles to cut on.
- Chat/content on screen must be natural prose in the target language — **no test gibberish,
  no debug captions burned into the frame** (disable any on-page narration overlay).

### 2. Record an event *before* each beat

Author events in the CSS coordinate space (1600-wide), timestamped so the editor can place
zooms and callouts on exact UI elements. First line after the page exists:

```ts
const t0 = Date.now()   // or use epoch directly and let the assembler rebase
```

Then, immediately **before** each action:

```ts
events.push({
  tMs: Date.now() - t0,             // or tsMs: Date.now() for epoch, rebased at assembly
  label,                            // what the beat is ("open group", "type reply", …)
  box: await locator.boundingBox(), // element rect in CSS coords — where to aim a zoom
  // zoom?: optional target zoom for this beat
})
```

`boundingBox()` returns CSS-space coordinates (because the context DSR keeps layout at
1600-wide) — so events line up with the 2× frames after the assembler scales them. Record the
event *before* the action so the timestamp marks the beat's start, not its completion.

### 3. Frames + events → assemble → CFR mp4 + rebased events

`toolkit/capture/promo-assemble.mjs` turns the raw capture into an editable intermediate:

```
node promo-assemble.mjs <actDir> --name act1 [--crf 13] [--fps 30]
```

- Reads `frames.json`, builds an **ffconcat** list where each frame's on-screen duration = the
  real gap to the next frame's timestamp (variable capture cadence → honest playback timing),
  tail frame held to `endTsMs`. Non-monotonic timestamps throw.
- Encodes to **CFR** via `-vf fps=30,format=yuv420p -c:v libx264 -crf 13 -movflags +faststart`.
  CRF 13 is visually lossless for this content.
- If `events-epoch.json` is present, rebases every event to first-frame-relative and writes
  `<name>.events.json` (`{ video, durationMs, events: [{ tMs, label, box?, zoom? }] }`) — the
  editor consumes this to drive zooms/callouts on the exact elements you annotated.

The assembler is product-agnostic: it only knows frames + timestamps + events. Nothing above
the recorder's on-disk contract needs to change per product.

---

## Your capture machine

Everything above assumes a headless-capable box with a modern Chromium (via Playwright) and
ffmpeg. Run the recorder against your product's dev/web build — whatever URL serves the real UI
you want on camera. The machine-specific pieces (which host, which checkout, how you reach it)
are yours to wire up; none of the capture logic depends on them. The only hard requirements are:

- Chromium launched with `--force-device-scale-factor=2` (the resolution self-check enforces it).
- A page URL that renders your real product with realistic state (see
  `orchestration-harness.md` — a blank account reads as a toy on camera).
- ffmpeg on PATH (or `PROMO_FFMPEG` pointing at a binary) for assembly.
