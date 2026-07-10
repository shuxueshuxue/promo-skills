---
name: promo-video
description: >-
  Make a real product promo video end-to-end: mine the product for a coherent
  narrative, capture the REAL app (Playwright/CDP, HD), review each clip with a
  human in the loop, then assemble one continuous "grand take" in Remotion with
  narration, virtual camera, background music and QA. Use this when asked to
  produce a launch / demo / promo video for a software product — not when a
  motion-graphics-only or talking-head video is wanted (this pipeline's first-
  class footage is the running product itself).
---

# promo-video — filming a product from its own running UI

This skill is the distilled workflow behind a real 100-second product launch film
(《一个 idea 的旅程》 for the "gugu" agent-chat app), shot the night before a demo day.
Every rule in `references/director-rulings.md` is a scar — a real reviewer rejection
that cost a re-shoot. Read this file top-to-bottom once, then keep
`references/director-rulings.md` open as you work.

## The one idea

**The footage is the real product, running.** Not a rebuilt UI, not mockups. You
drive the actual app with Playwright/CDP, capture it at high resolution, and everything
cinematic — push-ins, cuts, captions, voiceover, music — is added *in post* as
deterministic render-time data. The raw take is never touched. This is what lets you
re-shoot a clip verbatim after a reviewer note and re-render in minutes.

Three pillars, borrowed and fused:
- **Remotion** is the render engine — React components are the video, every animation
  driven by `useCurrentFrame()`/`interpolate()`, no CSS animation (deterministic,
  seek-safe, re-renderable). This is why "variants" are trivial: same clip, different props.
- **HyperFrames' knowledge structure** — the *vocabulary* of shooting techniques ("变式" /
  variants: coordinate-target-zoom, virtual-camera pan, narration overlay, …) and the
  storyboard-then-approve-gate workflow.
- **Playwright / CDP** capture — the real app is the subject; a service-role
  orchestration harness forges realistic live state so the recorded UI looks lived-in.

## The pipeline (stages)

```
 0. UNDERSTAND   read the product → user stories → ONE coherent narrative (no redundancy)
 1. SCREENPLAY   acts + beats + voiceover lines; each feature = a fragment with a story.md
 2. ORCHESTRATE  screenplay.json → timed service-role writes → realistic live state (prepare/perform/teardown)
 3. CAPTURE      drive the real app, record HD (CDP shot-loop @ real 2x), emit frames + event timeline
 4. ASSEMBLE     frames → CFR mp4 + rebased events.json  (per fragment: raw/)
 5. INGEST       fragments → renderer manifest (multi-camera split, path rewrite)
 6. VARIANTS     parameterized Remotion comps: zoom-follow, narration-overlay, …
 7. REVIEW       LAN board, per-clip URL, human rejects/annotates → feedback.jsonl → you iterate
 8. NARRATE      TTS (lines.json → id.mp3), captions timed to events
 9. FINAL CUT    ONE shared-world grand take → cutlist → camera + cuts + VO + BGM duck + CTA
10. QA           blackdetect blank-scan + VO↔picture alignment, same layout source-of-truth as the render
```

Stages 1–8 are the **fragment loop** — cheap, parallel, per-feature, human-reviewed until each
beat is approved. Stage 9 is the **grand take** — do NOT ship a stitch of approved fragments
(it feels disjointed, init is re-paid every clip, product state jumps). Instead re-shoot the
*approved performances* as one continuous session in a single shared world, then assemble.

## How to run it

### 0–1 · Understand → narrative → screenplay
- Read the product's own docs and drive it yourself. Write a **feature list**, then fold it
  into ONE story with causal spine — every beat must earn the next (see rulings §3).
- Kill redundancy. A promo is not a manual: cut any beat that only makes the viewer "know"
  something rather than "want" it (rulings §6).
- Write voiceover as plain speech, one line per beat. Each line's subject must be visible
  on screen the instant the line starts (rulings §7,8,20). Store beats per fragment:
  `fragments/<id>/story.md` + `meta.json` `{title, desc, act, order, role, vo:[..]}`.

### 2 · Orchestrate realistic state
The demoed app must look *used*, not fresh (a blank account reads as a toy — rulings §4).
`toolkit/orchestration/` drives your app's backend with service-role writes in phases:
`prepare` (mint accounts / relationships / groups / backfill history / seed presence) →
`perform` (a time-ordered timeline, `t0 = process start`, interleavable with real typing via
`--section`) → `teardown` (reverse-order delete, verify zero residue — you share the DB with
prod). This is the **product-specific adapter**: the phase model and screenplay JSON schema are
reusable; the actual writes are yours. See `references/orchestration-harness.md`.

### 3–4 · Capture HD, then assemble
- Record with `toolkit/capture/recorder-shotloop.ts` (`ShotLoopRecorder`): a CDP
  `Page.captureScreenshot` pull-loop. **Launch with `--force-device-scale-factor=2`** — that
  is the *only* real source of 2× (per-context `deviceScaleFactor` is a lie under headless).
  It self-checks the first frame's width and fails loud if you forgot the flag.
- Perform like a human: hover/pause ≥300ms before clicks, type 60–90ms/char, let animations
  finish, hold 2s at head and tail. Record an event *before* each beat:
  `{tMs, label, box: locator.boundingBox(), zoom?}`.
- `toolkit/capture/promo-assemble.mjs` turns `frames/` + per-frame epoch timestamps into a
  CFR mp4 and rebases the event timeline to video-relative `tMs`.
- Why shot-loop and nothing else: `references/capture-real-product.md` has the full bench —
  screencast starves to 0.2fps on real pages, Playwright trace caps at 800×500, OS capture is
  blocked over SSH, beginFrame crashes the browser. shot-loop @2x won the "clean at 2.6× zoom"
  acceptance gate. Don't re-litigate it.

### 5–6 · Ingest + variants
- `toolkit/ingest.mjs` packages each `fragments/<id>/` into `renderer/`'s typed manifest,
  splits multi-camera takes into `<id>--A` / `--B`, cleans null boxes, rewrites asset paths.
- A **variant** is the same clip through a different Remotion comp. The two core ones ship here:
  `ZoomFollow` (event-driven virtual camera — see below) and `NarrationOverlay` (slow Ken Burns
  + glass caption bar). Add your own as parameterized comps; the technique vocabulary is
  `references/variants-techniques.md`.

### 7 · Review loop (human in the loop)
Start `node toolkit/review-server.mjs` (zero-dep, `PORT` env, bind to your LAN so collaborators
can watch). It's deliberately **flicker-free**: a static index, one dedicated URL per artifact,
Range-served media. Reviewers only **reject** or **annotate** — there is no "approve" button;
approval is implicit (a clip with no open rejection newer than its latest render). Feedback is
appended to `review/feedback.jsonl`; tail it (Claude's Monitor, or `tail -f`) so a click wakes
you into the next iteration. The board's status state machine (工作中 / 待审批 / 待复审 第N轮)
is derived purely from file mtimes vs. the event log — the filesystem *is* the database. Contract:
`references/review-loop.md`.

### 8 · Narrate
`node toolkit/tts.mjs --lines lines.json --outdir narration/`. `lines.json` is `[{id,text,voice?,speed?}]`
→ writes `<id>.mp3` deterministically. Keys are env-only (`YUNWU_API_KEY` or `OPENROUTER_API_KEY`);
swap providers by editing `synth()`. One voice for the whole film — a mid-film timbre change is a
visible defect (rulings §16,21). Captions live in `captions.json`
`[{t0Ms,t1Ms,text,audio}]`, each cue ≥ its mp3 duration + 400ms.

### 9 · Final cut — the grand take
Edit exactly one file: `toolkit/renderer/src/final/cutlist.ts`. It is the single source of truth —
an ordered list of `synth` segments (your bespoke intro/CTA React scenes) and `video` segments
(real takes) with `keepMs` spans, per-segment `vos` cues (`{vo, atMs}`), transitions, and global
knobs (`FPS`, `FADE_FRAMES`, `RATE=1.25` speed-up, `VO_TABLE`, `BGM` duck config). `layoutCutlist()`
computes starts, VO cue frames and BGM duck windows at compile time; `FinalCut.tsx` renders it —
`TransitionSeries` of segments, event-driven camera on video segs, one looped BGM track with a
`volume` callback that ducks under every VO. Re-sourcing is `SWAP-GUIDE.md`: drop new
`actN.mp4` + `actN.events.json`, point `src`/`eventsFile`, redraw `keepMs`, align `vos[].atMs`.
Render: `npx remotion render final-cut …`.

**Virtual camera & the zoom whitelist (rulings §10,11):** push-ins are computed, not keyframed —
`buildCameraKeys` in `lib/camera.ts` emits approach/focus/hold/pull-back keyframes from event
boxes, with a geometric pan-clamp so a zoomed card never exposes black bars. Crucially it is a
**whitelist**: if any event carries a `zoom` field, only `zoom:true` events push in. Zoom only the
*subject of the line being spoken right now*; end events never zoom (auto-return to wide).

### 10 · QA (mandatory after every re-source)
`node toolkit/renderer/scripts/final-cut-qa.mjs` imports the *same* `cutlist.ts` the renderer uses
(no duplicated geometry) and gates on: duration consistency (±0.5s, warn outside 90–110s);
**blank-screen scan** — ffmpeg `blackdetect` (black + negated-white) inside the card interior, any
solid frame ≥0.4s fails (no dead air, ever — rulings §20); and a **VO↔picture** frame dump at each
cue's start+mid for the one check a machine can't make: is the on-screen subject the line's subject.

## Working method (how the night actually went — meta-rules)

- **Fan out.** Fragments are independent — one subagent per fragment captures in parallel (each
  mints its own isolated accounts against a shared dev server). Rendering parallelizes too.
- **Never fall back to a placeholder** ("别保底"). Fail loud and fix the root cause. A blank frame,
  a stubbed control, a "probably fine" clip — all get rejected. Evidence is a full before/after,
  never a loading state or two afters.
- **Shared world beats stitching.** One continuous session, one cast, one history — see §9.
- **Render on the beefy machine, transfer only the finished mp4.** Never rsync `frames/` across
  the network (rulings §23).
- **Saturation rescue when time-critical.** For the hard, deadline-bound re-master, run two
  independent lanes (A/B) that don't talk to each other, then pick the better cut.
- **The rulings codex is append-only and load-bearing.** When a reviewer rejects for a new reason,
  add the rule. Self-check every act against the whole list before you call it shot.

## Repo map

- `SKILL.md` (this file) — the workflow.
- `references/` — the deep contracts: `director-rulings.md` (the codex), `capture-real-product.md`
  (HD capture bench + verdicts), `orchestration-harness.md`, `variants-techniques.md`,
  `review-loop.md`, `final-assembly.md`, `data-contracts.md` (every JSON/TS schema).
- `toolkit/` — the runnable, product-agnostic tools (review server, TTS, ingest, capture recorder
  + assembler, Remotion renderer skeleton, QA). Product-specific seams are marked.
- `examples/gugu-case-study.md` — the real run, end to end, as a worked example.
