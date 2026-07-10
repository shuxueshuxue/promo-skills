# synth/ — your product's hand-authored scenes

"Synth" segments are the parts of the film that are **not** real screen recordings — the
prologue/hero shot, an abstract pain dramatization, the closing CTA card. They're authored as
Remotion React components (frame-driven, deterministic) and referenced from
[`../final/cutlist.ts`](../final/cutlist.ts) by their `comp` key.

| File | `comp` key | What it is | Ships as |
|---|---|---|---|
| `C1Pain.tsx` | `c1-pain` | opening / pain dramatization | **placeholder** — replace with yours |
| `C2LocalIdea.tsx` | `c2-local-idea` | a second hand-authored beat | **placeholder** — replace or delete the segment |
| `../final/CtaCard.tsx` | `cta-card` | closing call-to-action card | a real, reusable CTA card — edit the copy |
| `shared.tsx` | — | reusable primitives: `FONT`, `CaptionBar` (the glass subtitle pill), `MockWindow`, colors | reuse as-is |

`shared.tsx` and `CtaCard.tsx` are genuinely reusable. `C1Pain`/`C2LocalIdea` were gugu's bespoke
creative scenes (a 3D-office montage and a terminal shot) — they ship here as labeled placeholders
so the renderer compiles. Replace them with your own, keeping the export names (or rename in
`cutlist.ts`, `FinalCut.tsx`, and `Root.tsx` too). Follow Remotion's rules: drive everything from
`useCurrentFrame()`/`interpolate()`, never CSS animation or `Math.random()`/`Date.now()` — the
render must be deterministic and seek-safe.
