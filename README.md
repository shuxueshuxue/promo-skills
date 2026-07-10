# promo-skills

**A Claude Code / agent skill for making a real product launch video — by filming the
product's own running UI, not by rebuilding it in motion graphics.**

This is the distilled, reusable workflow behind a real 100-second product launch film,
shot end-to-end (the night before a demo day) by an agent driving the actual app. Every
rule in [`references/director-rulings.md`](references/director-rulings.md) was earned by a
real reviewer rejection.

## The idea in one line

> The footage is the real product, running. Everything cinematic — push-ins, cuts,
> captions, voiceover, music — is added in post as deterministic render-time data, so any
> clip can be re-shot verbatim after a note and re-rendered in minutes.

Three tools, fused:

| Pillar | Role |
|---|---|
| **Playwright / CDP** | drive & capture the real app at HD; a service-role harness forges realistic live state |
| **Remotion** | render engine — React *is* the video (frame-driven, deterministic, re-renderable); "variants" are just different props |
| **HyperFrames' knowledge structure** | the vocabulary of shooting techniques + the storyboard-then-approve-gate review loop |

## Quickstart

1. **Read [`SKILL.md`](SKILL.md).** It is the workflow, top to bottom. Then keep
   [`references/director-rulings.md`](references/director-rulings.md) open while you work.
2. Install the toolkit: `cd toolkit && npm install` (and `cd toolkit/renderer && npm install`
   for the Remotion renderer).
3. Run the fragment loop per feature: orchestrate state → capture HD → assemble → review →
   iterate. Then shoot the **grand take** and assemble the final cut.

```
 0. UNDERSTAND   product → user stories → ONE coherent narrative (no redundancy)
 1. SCREENPLAY   acts + beats + voiceover; each feature = a fragment
 2. ORCHESTRATE  screenplay.json → timed service-role writes → realistic live state
 3. CAPTURE      drive the real app, record HD (CDP shot-loop @ real 2×)
 4. ASSEMBLE     frames → CFR mp4 + rebased events.json
 5. INGEST       fragments → renderer manifest
 6. VARIANTS     parameterized Remotion comps (zoom-follow, narration-overlay, …)
 7. REVIEW       LAN board, human rejects/annotates → feedback.jsonl → you iterate
 8. NARRATE      TTS (lines.json → id.mp3), captions timed to events
 9. FINAL CUT    ONE shared-world grand take → cutlist → camera + cuts + VO + BGM + CTA
10. QA           blackdetect blank-scan + VO↔picture alignment
```

## Layout

```
SKILL.md                     the workflow (start here)
references/
  director-rulings.md        the codex of scars — reject-driven rules (read alongside SKILL.md)
  capture-real-product.md    HD-capture bench: what won (CDP shot-loop @2×) and what died, with reasons
  orchestration-harness.md   forging realistic live state (the one product-specific adapter)
  variants-techniques.md     the "变式" vocabulary — zoom-follow, narration-overlay, and how to add more
  review-loop.md             the LAN review board protocol + status state machine
  final-assembly.md          the grand-take approach + cutlist source-of-truth + QA gate
  data-contracts.md          every JSON/TS schema in one place
toolkit/                     runnable, product-agnostic tools (product-specific seams are marked)
  review-server.mjs          zero-dep LAN review board
  tts.mjs                    narration TTS (env-only keys; swap provider in synth())
  ingest.mjs                 fragments → renderer manifest
  capture/                   recorder-shotloop.ts (CDP HD recorder) + promo-assemble.mjs
  orchestration/             service-role state harness (adapter you implement for your backend)
  renderer/                  Remotion skeleton — lib/camera+edit+types, final/cutlist+FinalCut, QA
examples/
  gugu-case-study.md         the real run, end to end, as a worked example
```

## What this is *not*

- Not a motion-graphics or talking-head generator — its first-class footage is a real product.
- Not turnkey. The capture harness and the intro/CTA scenes are yours to adapt; the pipeline,
  the camera/edit/assembly mechanism, the review loop and the QA gate are reusable as-is.

## Credits & lineage

Built by fusing three open efforts — [Remotion](https://www.remotion.dev/docs/ai/skills),
[GSAP skills](https://github.com/greensock/gsap-skills), and HeyGen's
[HyperFrames](https://github.com/heygen-com/hyperframes) — with a real-product Playwright/CDP
capture path. The gugu launch film is the reference implementation.

## License

MIT — see [LICENSE](LICENSE).
