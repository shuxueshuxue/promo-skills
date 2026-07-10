# The Director's Rulings — a codex of scars

Every rule below was earned by a real reviewer rejection that cost a re-shoot on the
gugu launch film. It is an **append-only, load-bearing** document: when a new class of
mistake gets rejected, add a rule; before you call any act "shot," self-check it against
the whole list. The gugu-specific examples are kept deliberately — they make each abstract
rule concrete. Translate them to your product.

Reviewing is **reject-or-annotate only, never approve** (§18). Approval is the *absence*
of an open rejection newer than the latest render.

## Content & narrative

1. **The product must be the protagonist.** Human-to-human chat can't stand as a clip on
   its own; every shot needs the product's distinctive value on screen (for gugu: an
   *agent* — entity / badge / running-state / replying). Ask of each shot: is this showing
   what makes us *us*, or a commodity feature anyone has?
2. **Don't shoot the commodity.** Add-friend, read-receipts, unread badges are table
   stakes — the least-common-denominator of every IM. Spend screen time on the thing only
   your product does.
3. **The causal spine must hold.** Each beat must *earn* the next. gugu scar: showing a
   local terminal refining an idea → *then* "inherit that memory to the cloud agent" reads;
   opening inside the product chatting and *then* creating the agent is a logic break (the
   m1 rejection). If beat B doesn't follow from beat A, the viewer feels the seam.
4. **The frame must be full, must look lived-in.** Real activity density, status bars,
   unread badges, history. A fresh empty account + one message reads as a toy. Seed real
   state (see `orchestration-harness.md`).
5. **No small talk.** Ordering lunch, pleasantries, anything off-mission gets cut. Every
   line of on-screen dialogue serves the story's world.

## Voiceover (one voice for the whole film; write plain)

6. **No manual-speak.** Internal code-names, interaction-spec recitations ("the exit is
   always top-left"), tech jargon ("realtime", "refresh") do not belong in a promo. Every
   line: does the viewer come away *wanting* this, or merely *informed*?
7. **No voiceover gap.** Any 5s+ of performance with no line playing leaves the viewer not
   knowing what they're watching (three separate rejections: a creation beat, a second-angle
   beat, a celebration beat — all silent). At assembly, walk each act's caption coverage
   segment by segment.
8. **The line is never late.** The line starts *with* the action, not after it finishes.
9. **Keep it plain.** No piled-up rhetoric, no announcer voice — talk like you're showing a
   colleague something. Run every newly-written line through a "plain" check before it ships.

## Camera

10. **Zoom is a whitelist.** Push in *only* on the subject the current line is naming. Random
    zooms get rejected. Mechanically: only events tagged `"zoom": true` trigger a push-in; a
    meaningful zoom is one whose target is what's being spoken about right now.
11. **End events never zoom.** Closing/`end-*` events auto-return to wide — zooming at the end
    is "meaning unclear."
12. **Dead pacing gets cut.** A spinner, a typing stretch, a static hold longer than the eye
    needs — cut it. Record a timestamp at every beat so the editor can cut precisely.
13. **An empty stage is embarrassing.** After a team/group forms there must be a roll-call
    beat; the frame must never show "a crowd all in running-state but nobody speaking."

## Technical acceptance gates

14. **Clarity is the first gate.** The default screen-recording (`recordVideo`) was rejected
    as "too blurry" by the director. The standard: after a **2.6× zoom**, small text edges
    stay clean. That forces the CDP shot-loop @ real-2× pipeline (`capture-real-product.md`).
15. **Target ~2 minutes.** Before shooting, produce a per-segment estimated-duration table
    (VO measured length + beat performance + transition slack); the director signs off, then
    you shoot.
16. **Change the voice once → regenerate everywhere.** Any voice/wording change forces a full
    re-generation and re-sync into the renderer's assets (the "two voices in one scene" scar).
17. **State is shared.** The final film is one continuous world — people, agents, groups,
    history consistent throughout. No per-act fresh initialization.

## Review process & assembly

18. **Review has only "reject" and "annotate," no "approve."** A rejected clip, once re-shot
    and re-rendered, becomes "pending re-review, round N."
19. **Every fragment is named and placed.** Chinese title + description + owning act
    (`meta.json`); the relationship between a fragment and the master screenplay must be
    *visible* on the board — an orphan clip nobody can map to the story is a smell.
20. **VO↔picture alignment is the #1 assembly acceptance item.** Sample the start/mid frame of
    every VO line: the screen must show *exactly* that line's subject ("a new collaborator
    arrives" ⇒ frame is mid add-contact). No blank/black frame anywhere — scan the whole film
    with ffmpeg `blackdetect`, humans only spot-check. Re-run this after any re-source.
21. **One VO track per act.** The master VO and any component-embedded narration must never
    overlap (the prologue double-track / double-timbre accident). One timbre, one speed, for
    the entire film; every regenerated line carries the same params.
22. **Final pacing = 1.25× speed-up.** Video segments play at 1.25×; timeline anchors remap by
    /1.25; VO audio is *not* sped up (no pitch shift) and is re-anchored to the remapped beat
    points (not the old timestamps); BGM is not sped up. gugu target ≈96s.
23. **Render on the capture machine; transfer only the finished mp4.** Re-render where the raw
    frames already live (zero transfer). Never move `frames/` across the network; cross-machine
    transfer is rsync `--partial --inplace` of the finished cut only.
